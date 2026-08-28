package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Sanitized run-scoped working memory for the agent brain.
 * Stores only summaries — never raw credentials, secrets, or chain-of-thought.
 */
class AgentMemoryStore(private val dataSource: DataSource?) {
    private val log = LoggerFactory.getLogger(AgentMemoryStore::class.java)
    private val mapper = jacksonObjectMapper()
    private val MAX_VALUE_BYTES = 4096

    fun persist(config: AgentBrainConfig, key: String, valueSanitized: Any?) {
        if (dataSource == null) return
        try {
            val json = mapper.writeValueAsString(valueSanitized ?: "").take(MAX_VALUE_BYTES)
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "INSERT INTO agent_memory_entries (workspace_id,environment_id,run_id,agent_id,step_id,memory_scope,key,value_json_sanitized) VALUES(?,?,?,?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING"
                ).use { stmt ->
                    stmt.setObject(1, config.workspaceId); stmt.setObject(2, config.environmentId)
                    stmt.setObject(3, config.runId); stmt.setObject(4, config.agentId)
                    stmt.setString(5, config.stepId); stmt.setString(6, "run_scoped")
                    stmt.setString(7, key.take(255)); stmt.setString(8, json)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) { log.warn("[memory] persist failed key={}: {}", key, e.message) }
    }

    /** Writes entries created during THIS execution. Recalled ones are already stored. */
    fun persistAll(config: AgentBrainConfig, state: AgentLoopState) {
        state.memoryEntries.filterNot { it.recalled }
            .forEach { persist(config, it.key, it.sanitizedSummary) }
    }

    fun load(runId: UUID, agentId: UUID): Map<String, String> {
        if (dataSource == null) return emptyMap()
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT key, value_json_sanitized::text FROM agent_memory_entries WHERE run_id=? AND agent_id=? ORDER BY created_at"
                ).use { stmt ->
                    stmt.setObject(1, runId); stmt.setObject(2, agentId)
                    val rs = stmt.executeQuery()
                    /* Values are stored as JSON, so a plain summary comes back as a
                       QUOTED, escaped JSON string. Unwrap scalars — handing the model
                       `"Tool returned 2 field(s): status, body"` complete with escapes is
                       needlessly harder to read than the sentence itself. Objects and
                       arrays are left as JSON, which is what they were. */
                    buildMap {
                        while (rs.next()) {
                            val raw = rs.getString("value_json_sanitized") ?: continue
                            val text = if (raw.startsWith("\"")) {
                                runCatching { mapper.readValue(raw, String::class.java) }.getOrDefault(raw)
                            } else raw
                            put(rs.getString("key"), text)
                        }
                    }
                }
            }
        } catch (e: Exception) { log.warn("[memory] load failed: {}", e.message); emptyMap() }
    }
}
