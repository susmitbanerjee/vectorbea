package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Sanitized working memory for the agent brain.
 * Stores only summaries — never raw credentials, secrets, or chain-of-thought.
 *
 * ── TWO SCOPES, AND ONLY ONE OF THEM IS SAFE BY DEFAULT ─────────────────────
 * `run_scoped` is a transcript. It dies with its run, cannot grow without bound,
 * and has been the only implemented scope since V010.
 *
 * `workflow_scoped` outlives the run that wrote it, which is the entire point —
 * it is the difference between an agent that learns across runs and one that
 * starts cold every time — and is also what makes it dangerous. Every run adds
 * entries and every subsequent run reads them into a prompt, so without limits
 * it is an unbounded prompt-growth vector that fails slowly, in production, on
 * whichever workflows are used most. Three limits ship WITH it rather than
 * after it:
 *
 *   * a per-entry byte cap ([MAX_VALUE_BYTES]),
 *   * a per-(workflow, agent) entry-count cap ([workflowMemoryMaxEntries]),
 *     enforced at write time because "keep the newest N" is not expressible as
 *     a constraint, and
 *   * a TTL ([workflowMemoryRetentionDays]) stamped on the row, swept by
 *     `agent_memory_prune_expired`.
 *
 * And it is behind [WORKFLOW_MEMORY_ENABLED], default off. Flag off, the class
 * behaves exactly as it did before V043.
 */
class AgentMemoryStore(
    private val dataSource: DataSource?,
    /**
     * Mirrors AGENT_WORKFLOW_MEMORY_ENABLED. A parameter so a test can drive both
     * paths in one JVM without mutating process environment.
     */
    private val workflowMemoryEnabled: Boolean = WORKFLOW_MEMORY_ENABLED,
    private val workflowMemoryMaxEntries: Int = WORKFLOW_MEMORY_MAX_ENTRIES,
    private val workflowMemoryRetentionDays: Int = WORKFLOW_MEMORY_RETENTION_DAYS,
) {
    private val log = LoggerFactory.getLogger(AgentMemoryStore::class.java)
    private val mapper = jacksonObjectMapper()
    private val MAX_VALUE_BYTES = 4096

    companion object {
        /** Default OFF. Memory that crosses runs changes behaviour on workflows
         *  nobody touched, so it is opted into rather than inherited. */
        val WORKFLOW_MEMORY_ENABLED: Boolean =
            System.getenv("AGENT_WORKFLOW_MEMORY_ENABLED")?.lowercase() == "true"

        /**
         * Newest N per (workflow, agent). Chosen to bound the PROMPT, not the
         * table: 50 entries at the 4 KiB per-entry cap is a 200 KiB worst case,
         * and the recall in [loadWorkflow] takes far fewer than that.
         */
        val WORKFLOW_MEMORY_MAX_ENTRIES: Int =
            System.getenv("AGENT_WORKFLOW_MEMORY_MAX_ENTRIES")?.toIntOrNull()?.coerceIn(1, 1000) ?: 50

        val WORKFLOW_MEMORY_RETENTION_DAYS: Int =
            System.getenv("AGENT_WORKFLOW_MEMORY_RETENTION_DAYS")?.toIntOrNull()?.coerceIn(1, 3650) ?: 30

        /** How many entries a recall puts in front of the model. */
        val WORKFLOW_MEMORY_RECALL_LIMIT: Int =
            System.getenv("AGENT_WORKFLOW_MEMORY_RECALL_LIMIT")?.toIntOrNull()?.coerceIn(1, 100) ?: 10
    }

    // ── Run-scoped: unchanged ────────────────────────────────────────────────

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
                    "SELECT key, value_json_sanitized::text FROM agent_memory_entries WHERE run_id=? AND agent_id=? AND memory_scope='run_scoped' ORDER BY created_at"
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
                            put(rs.getString("key"), unwrap(raw))
                        }
                    }
                }
            }
        } catch (e: Exception) { log.warn("[memory] load failed: {}", e.message); emptyMap() }
    }

    // ── Workflow-scoped ──────────────────────────────────────────────────────

    /**
     * Record a fact this agent should still know on the NEXT run of this
     * workflow.
     *
     * Upsert, not append. Run memory is a transcript and appends; a workflow fact
     * is a fact, and appending one per run means an agent that records
     * `customer.timezone` every run accumulates a row per run forever and recalls
     * all of them. `uq_agent_memory_workflow_key` enforces that here so a buggy
     * writer cannot opt out.
     *
     * No-op when the flag is off, when there is no workflow to key on, or when
     * there is no database — in every case the agent simply has no long memory,
     * which is exactly today's behaviour.
     */
    fun persistWorkflowScoped(
        config: AgentBrainConfig,
        workflowId: UUID?,
        key: String,
        valueSanitized: Any?,
    ) {
        if (!workflowMemoryEnabled || dataSource == null || workflowId == null) return
        if (key.isBlank()) return
        try {
            val json = mapper.writeValueAsString(valueSanitized ?: "").take(MAX_VALUE_BYTES)
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_memory_entries
                         (workspace_id, environment_id, run_id, workflow_id, agent_id, step_id,
                          memory_scope, key, value_json_sanitized, expires_at)
                       VALUES (?,?,?,?,?,?, 'workflow_scoped', ?, ?::jsonb, now() + make_interval(days => ?))
                       ON CONFLICT (workspace_id, workflow_id, agent_id, key)
                         WHERE memory_scope = 'workflow_scoped'
                       DO UPDATE SET value_json_sanitized = EXCLUDED.value_json_sanitized,
                                     created_at = now(),
                                     expires_at = EXCLUDED.expires_at,
                                     run_id     = EXCLUDED.run_id"""
                ).use { st ->
                    st.setObject(1, config.workspaceId); st.setObject(2, config.environmentId)
                    st.setObject(3, config.runId); st.setObject(4, workflowId)
                    st.setObject(5, config.agentId); st.setString(6, config.stepId)
                    st.setString(7, key.take(255)); st.setString(8, json)
                    st.setInt(9, workflowMemoryRetentionDays)
                    st.executeUpdate()
                }
            }
            enforceEntryCap(config.workspaceId, workflowId, config.agentId)
        } catch (e: Exception) {
            log.warn("[memory] workflow persist failed key={}: {}", key, e.message)
        }
    }

    /**
     * What this agent learned on earlier runs of this workflow.
     *
     * Newest first and capped at [WORKFLOW_MEMORY_RECALL_LIMIT] — the recall limit
     * is smaller than the storage cap on purpose. The cap bounds what the table
     * holds; this bounds what the PROMPT holds, and the prompt is the thing that
     * breaks. Expired rows are filtered here as well as swept, so a lapsed sweep
     * degrades to a larger table rather than to stale facts in a prompt.
     */
    fun loadWorkflow(
        workspaceId: UUID,
        workflowId: UUID?,
        agentId: UUID,
        limit: Int = WORKFLOW_MEMORY_RECALL_LIMIT,
    ): Map<String, String> {
        if (!workflowMemoryEnabled || dataSource == null || workflowId == null) return emptyMap()
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT key, value_json_sanitized::text AS v
                         FROM agent_memory_entries
                        WHERE workspace_id=? AND workflow_id=? AND agent_id=?
                          AND memory_scope='workflow_scoped'
                          AND (expires_at IS NULL OR expires_at > now())
                        ORDER BY created_at DESC
                        LIMIT ?"""
                ).use { st ->
                    st.setObject(1, workspaceId); st.setObject(2, workflowId)
                    st.setObject(3, agentId); st.setInt(4, limit)
                    st.executeQuery().use { rs ->
                        buildMap {
                            while (rs.next()) put(rs.getString("key"), unwrap(rs.getString("v") ?: ""))
                        }
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[memory] workflow load failed: {}", e.message); emptyMap()
        }
    }

    /**
     * Keep only the newest [workflowMemoryMaxEntries] per (workflow, agent).
     *
     * At write time rather than on a schedule, because the cap's job is to stop
     * the table growing between sweeps — a nightly job leaves a busy workflow
     * unbounded for a day, which on a workflow that runs every minute is the
     * whole problem.
     */
    private fun enforceEntryCap(workspaceId: UUID, workflowId: UUID, agentId: UUID) {
        val ds = dataSource ?: return
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """DELETE FROM agent_memory_entries
                        WHERE id IN (
                          SELECT id FROM agent_memory_entries
                           WHERE workspace_id=? AND workflow_id=? AND agent_id=?
                             AND memory_scope='workflow_scoped'
                           ORDER BY created_at DESC
                          OFFSET ?
                        )"""
                ).use { st ->
                    st.setObject(1, workspaceId); st.setObject(2, workflowId)
                    st.setObject(3, agentId); st.setInt(4, workflowMemoryMaxEntries)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[memory] entry cap sweep failed: {}", it.message) }
    }

    /**
     * Delete expired workflow memory. Bounded per call.
     *
     * Returns how many rows went, so a caller can loop until it returns less than
     * [batchSize] rather than guessing. Batched because this table is read on
     * every agent iteration and a long lock on it stalls every running agent.
     */
    fun pruneExpired(batchSize: Int = 1000): Int {
        val ds = dataSource ?: return 0
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement("SELECT agent_memory_prune_expired(?)").use { st ->
                    st.setInt(1, batchSize)
                    st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
                }
            }
        }.getOrElse { log.warn("[memory] prune failed: {}", it.message); 0 }
    }

    private fun unwrap(raw: String): String =
        if (raw.startsWith("\"")) runCatching { mapper.readValue(raw, String::class.java) }.getOrDefault(raw)
        else raw
}
