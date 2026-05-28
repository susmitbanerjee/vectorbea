package com.vectorbea.worker.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Persists step outputs to the `step_outputs` table.
 *
 * Each step gets three output tiers persisted independently:
 *   rawOutputJsonSanitized       — the direct executor result (keys only for sensitive nodes)
 *   extractedOutputJsonSanitized — after [OutputExtractor] runs
 *   validatedOutputJsonSanitized — after [JsonSchemaValidator] runs (same data, error-annotated)
 *
 * SECURITY:
 *   - Output JSON stored here originates from node executors (LLM responses, HTTP bodies, etc.).
 *   - Caller is responsible for sanitizing before calling [save] — raw payloads containing
 *     secrets, credentials, or PII must NOT be passed directly.
 *   - This class stores whatever it receives without further sanitization.
 *   - The column suffix "_sanitized" is a contract with the caller.
 */
open class StepOutputStore(private val dataSource: DataSource) {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * Persist (upsert) all three tiers for a node execution.
     * If a row for (runId, nodeId) already exists, it is updated.
     *
     * Tiers with null values are skipped (existing column value preserved).
     */
    open fun save(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        nodeId: String,
        nodeType: String,
        rawOutput: Map<String, Any>?,
        extractedOutput: Map<String, Any>?,
        validatedOutput: Map<String, Any>?,
        validationErrors: List<String> = emptyList(),
    ) {
        val rawJson       = rawOutput?.let       { toJson(it) }
        val extractedJson = extractedOutput?.let { toJson(it) }
        val validatedJson = validatedOutput?.let { toJson(it) }
        val errorsJson    = if (validationErrors.isEmpty()) null else toJson(mapOf("errors" to validationErrors))

        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(UPSERT_SQL).use { stmt ->
                    val now = Timestamp.from(Instant.now())
                    stmt.setObject(1, UUID.randomUUID())
                    stmt.setObject(2, runId)
                    stmt.setObject(3, workspaceId)
                    stmt.setObject(4, environmentId)
                    stmt.setString(5, nodeId)
                    stmt.setString(6, nodeType)
                    setJsonb(stmt, 7, rawJson)
                    setJsonb(stmt, 8, extractedJson)
                    setJsonb(stmt, 9, validatedJson)
                    setJsonb(stmt, 10, errorsJson)
                    stmt.setTimestamp(11, now)
                    stmt.setTimestamp(12, now)
                    // ON CONFLICT update columns
                    setJsonb(stmt, 13, rawJson)
                    setJsonb(stmt, 14, extractedJson)
                    setJsonb(stmt, 15, validatedJson)
                    setJsonb(stmt, 16, errorsJson)
                    stmt.setTimestamp(17, now)
                    stmt.executeUpdate()
                }
            }
            log.debug("[step-output] saved [runId={}, nodeId={}]", runId, nodeId)
        } catch (e: Exception) {
            // Non-fatal — step output persistence failure should not abort the run
            log.warn("[step-output] failed to persist [runId={}, nodeId={}]: {}", runId, nodeId, e.message)
        }
    }

    /**
     * Load the raw output for a specific step.
     * Returns null if not found.
     */
    @Suppress("UNCHECKED_CAST")
    open fun loadRaw(runId: UUID, nodeId: String): Map<String, Any>? =
        loadColumn(runId, nodeId, "raw_output_json_sanitized")

    @Suppress("UNCHECKED_CAST")
    open fun loadExtracted(runId: UUID, nodeId: String): Map<String, Any>? =
        loadColumn(runId, nodeId, "extracted_output_json_sanitized")

    @Suppress("UNCHECKED_CAST")
    open fun loadValidated(runId: UUID, nodeId: String): Map<String, Any>? =
        loadColumn(runId, nodeId, "validated_output_json_sanitized")

    @Suppress("UNCHECKED_CAST")
    private fun loadColumn(runId: UUID, nodeId: String, column: String): Map<String, Any>? {
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT $column FROM step_outputs WHERE run_id = ? AND node_id = ? LIMIT 1"
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.setString(2, nodeId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        val json = rs.getString(column) ?: return@use null
                        mapper.readValue(json, Map::class.java) as Map<String, Any>
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[step-output] load failed [runId={}, nodeId={}, col={}]: {}", runId, nodeId, column, e.message)
            null
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun toJson(v: Any): String = mapper.writeValueAsString(v)

    private fun setJsonb(stmt: java.sql.PreparedStatement, i: Int, json: String?) {
        if (json != null) {
            val pgObj = org.postgresql.util.PGobject().apply { type = "jsonb"; value = json }
            stmt.setObject(i, pgObj)
        } else {
            stmt.setNull(i, java.sql.Types.OTHER)
        }
    }

    companion object {
        private val UPSERT_SQL = """
            INSERT INTO step_outputs (
                id, run_id, workspace_id, environment_id, node_id, node_type,
                raw_output_json_sanitized,
                extracted_output_json_sanitized,
                validated_output_json_sanitized,
                validation_errors_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (run_id, node_id) DO UPDATE SET
                raw_output_json_sanitized       = COALESCE(EXCLUDED.raw_output_json_sanitized,       step_outputs.raw_output_json_sanitized),
                extracted_output_json_sanitized = COALESCE(EXCLUDED.extracted_output_json_sanitized, step_outputs.extracted_output_json_sanitized),
                validated_output_json_sanitized = COALESCE(EXCLUDED.validated_output_json_sanitized, step_outputs.validated_output_json_sanitized),
                validation_errors_json          = COALESCE(EXCLUDED.validation_errors_json,          step_outputs.validation_errors_json),
                updated_at                      = EXCLUDED.updated_at
        """.trimIndent()
    }
}
