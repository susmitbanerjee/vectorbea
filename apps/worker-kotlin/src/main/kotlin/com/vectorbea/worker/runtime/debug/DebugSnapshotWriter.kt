package com.vectorbea.worker.runtime.debug

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.graph.WorkflowNode
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Persists per-node debug snapshots for "Debug Run" executions only.
 *
 * Normal Run Now executions never call this — keeps the debugger fully
 * separate from (and additive to) the regular run/event/log pipeline.
 *
 * SECURITY: every JSON blob passed in is redacted via [DebugRedactor]
 * before being serialized and stored.
 */
class DebugSnapshotWriter(private val dataSource: DataSource) {
    private val log = LoggerFactory.getLogger(DebugSnapshotWriter::class.java)
    private val mapper = jacksonObjectMapper()

    data class NodeDebugCapture(
        val workflowRunId: UUID,
        val workflowId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val nodeId: String,
        val nodeType: String,
        val nodeName: String?,
        val attempt: Int,
        val status: String, // pending | running | success | failed | skipped | retried
        val inputTemplate: Map<String, Any?>? = null,
        val resolvedInput: Map<String, Any?>? = null,
        val resolvedVariables: List<Map<String, Any?>>? = null,
        val variableSources: List<Map<String, Any?>>? = null,
        val output: Map<String, Any?>? = null,
        val parsedOutput: Map<String, Any?>? = null,
        val schemaValidation: Map<String, Any?>? = null,
        val errorType: String? = null,
        val errorMessage: String? = null,
        val humanFailureReason: String? = null,
        val suggestedFix: String? = null,
        val modelProvider: String? = null,
        val modelName: String? = null,
        val tokensInput: Int? = null,
        val tokensOutput: Int? = null,
        val costEstimate: Double? = null,
        val startedAt: Instant? = null,
        val finishedAt: Instant? = null,
        val durationMs: Long? = null,
    )

    /** Best-effort write — failures must never break workflow execution. */
    fun record(capture: NodeDebugCapture) {
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """
                    INSERT INTO workflow_node_debug_snapshots (
                        workflow_run_id, workflow_id, workspace_id, environment_id,
                        node_id, node_type, node_name, attempt, status,
                        input_template_json, resolved_input_json, resolved_variables_json, variable_sources_json,
                        output_json, parsed_output_json, schema_validation_json,
                        error_type, error_message, human_failure_reason, suggested_fix,
                        model_provider, model_name, tokens_input, tokens_output, cost_estimate,
                        started_at, finished_at, duration_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent()
                ).use { stmt ->
                    var i = 1
                    stmt.setObject(i++, capture.workflowRunId)
                    stmt.setObject(i++, capture.workflowId)
                    stmt.setObject(i++, capture.workspaceId)
                    stmt.setObject(i++, capture.environmentId)
                    stmt.setString(i++, capture.nodeId)
                    stmt.setString(i++, capture.nodeType)
                    stmt.setString(i++, capture.nodeName)
                    stmt.setInt(i++, capture.attempt)
                    stmt.setString(i++, capture.status)
                    stmt.setString(i++, toRedactedJson(capture.inputTemplate))
                    stmt.setString(i++, toRedactedJson(capture.resolvedInput))
                    stmt.setString(i++, toRedactedJson(capture.resolvedVariables))
                    stmt.setString(i++, toRedactedJson(capture.variableSources))
                    stmt.setString(i++, toRedactedJson(capture.output))
                    stmt.setString(i++, toRedactedJson(capture.parsedOutput))
                    stmt.setString(i++, toRedactedJson(capture.schemaValidation))
                    stmt.setString(i++, capture.errorType)
                    stmt.setString(i++, capture.errorMessage?.let { DebugRedactor.redactString(it) })
                    stmt.setString(i++, capture.humanFailureReason)
                    stmt.setString(i++, capture.suggestedFix)
                    stmt.setString(i++, capture.modelProvider)
                    stmt.setString(i++, capture.modelName)
                    setNullableInt(stmt, i++, capture.tokensInput)
                    setNullableInt(stmt, i++, capture.tokensOutput)
                    setNullableDouble(stmt, i++, capture.costEstimate)
                    stmt.setObject(i++, capture.startedAt?.let { java.sql.Timestamp.from(it) })
                    stmt.setObject(i++, capture.finishedAt?.let { java.sql.Timestamp.from(it) })
                    setNullableLong(stmt, i, capture.durationMs)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn("[debug-snapshot] failed to persist snapshot [runId={}, nodeId={}]: {}",
                capture.workflowRunId, capture.nodeId, e.message)
        }
    }

    private fun toRedactedJson(value: Any?): String? {
        if (value == null) return null
        return try {
            mapper.writeValueAsString(DebugRedactor.redactValue(value))
        } catch (e: Exception) {
            null
        }
    }

    private fun setNullableInt(stmt: java.sql.PreparedStatement, idx: Int, value: Int?) {
        if (value != null) stmt.setInt(idx, value) else stmt.setNull(idx, java.sql.Types.INTEGER)
    }

    private fun setNullableLong(stmt: java.sql.PreparedStatement, idx: Int, value: Long?) {
        if (value != null) stmt.setLong(idx, value) else stmt.setNull(idx, java.sql.Types.BIGINT)
    }

    private fun setNullableDouble(stmt: java.sql.PreparedStatement, idx: Int, value: Double?) {
        if (value != null) stmt.setDouble(idx, value) else stmt.setNull(idx, java.sql.Types.DOUBLE)
    }

    companion object {
        fun nodeName(node: WorkflowNode): String? = node.label.ifBlank { null }
    }
}

/**
 * Lightweight, self-contained secret redaction for debug snapshots.
 * Mirrors the spirit of api-kotlin's Redactor without taking a cross-module dependency.
 */
object DebugRedactor {
    private const val MASK = "[REDACTED]"

    private val SENSITIVE_KEYS = setOf(
        "password", "secret", "apikey", "api_key", "token", "accesstoken", "access_token",
        "refreshtoken", "refresh_token", "authorization", "auth", "cookie", "clientsecret",
        "client_secret", "privatekey", "private_key", "connectionstring", "connection_string",
        "byok", "credential", "credentials",
    )

    private val BEARER_REGEX = Regex("(?i)(Bearer|Basic|Token)\\s+([A-Za-z0-9._\\-+/=]{6,})")

    fun redactString(value: String): String =
        BEARER_REGEX.replace(value) { m ->
            val scheme = m.groupValues[1]
            val secret = m.groupValues[2]
            "$scheme ${maskTail(secret)}"
        }

    private fun maskTail(secret: String): String {
        if (secret.length <= 4) return "****"
        return "sk-****" + secret.takeLast(4)
    }

    @Suppress("UNCHECKED_CAST")
    fun redactValue(value: Any?): Any? = when (value) {
        null -> null
        is Map<*, *> -> redactMap(value as Map<String, Any?>)
        is List<*> -> value.map { redactValue(it) }
        is String -> redactString(value)
        else -> value
    }

    private fun redactMap(map: Map<String, Any?>): Map<String, Any?> = map.mapValues { (key, v) ->
        if (SENSITIVE_KEYS.any { key.lowercase().contains(it) }) {
            MASK
        } else {
            redactValue(v)
        }
    }
}
