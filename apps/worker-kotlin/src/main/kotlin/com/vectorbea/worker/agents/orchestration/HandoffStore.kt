package com.vectorbea.worker.agents.orchestration

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.recovery.sanitize.RecoverySanitizer
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * The delegation edges: who asked whom to do what, and why.
 *
 * ── THE REASON IS THE PRODUCT FEATURE HERE ──────────────────────────────────
 * The activation rows say a second agent ran. The spans say how long it took.
 * Neither says why the supervisor picked THAT worker for THIS subtask, and that
 * is the first thing anyone asks when a run went sideways. It is recorded once,
 * here, and nowhere else — so this write is not bookkeeping.
 *
 * Sanitized at the boundary, like every other model-authored string that reaches
 * storage: an agent explaining its choice can quote an error message that
 * contains a connection string.
 */
class HandoffStore(private val dataSource: DataSource?) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /** §5.1's five kinds. Only the first two are constructed in this phase. */
    enum class Kind { DELEGATE, TRANSFER, RETURN, ESCALATE, BROADCAST }

    /**
     * Record an edge. Best-effort: a handoff that cannot be recorded costs a line
     * in the constellation view, never the delegation itself.
     */
    fun record(
        runId: UUID,
        workspaceId: UUID,
        fromActivationId: UUID?,
        toActivationId: UUID,
        kind: Kind,
        reason: String?,
        contract: TaskContract,
        contractHash: String,
        contextVersion: Long,
        /**
         * Shared by one BROADCAST's children.
         *
         * What lets the debugger draw a fan-out as ONE thing. Without it, five
         * children of one broadcast are indistinguishable from five separate
         * delegations that happened to be adjacent — and "did the supervisor fan
         * out, or did it try five times" is exactly the question a constellation
         * view exists to answer.
         */
        joinGroupId: UUID? = null,
    ): UUID? {
        val ds = dataSource ?: return null
        return runCatching {
            val id = UUID.randomUUID()
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_handoffs
                         (id, run_id, workspace_id, from_activation_id, to_activation_id,
                          kind, reason, contract_json, contract_hash, context_version,
                          join_group_id)
                       VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?)"""
                ).use { st ->
                    st.setObject(1, id); st.setObject(2, runId); st.setObject(3, workspaceId)
                    st.setObject(4, fromActivationId); st.setObject(5, toActivationId)
                    st.setString(6, kind.name)
                    st.setString(7, reason?.let { RecoverySanitizer.sanitizeMessage(it)?.take(1000) })
                    st.setString(8, mapper.writeValueAsString(contract.toMap()))
                    st.setString(9, contractHash)
                    st.setLong(10, contextVersion)
                    st.setObject(11, joinGroupId)
                    st.executeUpdate()
                }
            }
            id
        }.getOrElse {
            log.warn("[handoff] record failed run={} to={}: {}", runId, toActivationId, it.message)
            null
        }
    }

    /**
     * How many times this exact request has already gone along this exact edge.
     *
     * ── THE EDGE IS BETWEEN AGENTS, NOT BETWEEN ACTIVATIONS ────────────────
     * Both sides resolve to every activation the agent has in this run, and that
     * is the whole reason the guard works. A→B→A→B creates a NEW activation at
     * every hop, so counting `(from_activation_id, to_activation_id)` finds one
     * row each time and never trips: the second A is a different activation from
     * the first, and the guard would happily let the pair ping-pong until the
     * iteration budget ran out. §9 says `(from, to, hash)`, and `from` and `to`
     * are agents.
     *
     * Both sides empty is impossible for a real delegation and returns zero
     * rather than counting every handoff in the run, which is the direction this
     * must fail if it fails at all.
     */
    fun countRepeats(
        runId: UUID,
        fromAgentActivationIds: Collection<UUID>,
        toAgentActivationIds: Collection<UUID>,
        contractHash: String,
    ): Int {
        val ds = dataSource ?: return 0
        if (toAgentActivationIds.isEmpty() || fromAgentActivationIds.isEmpty()) return 0
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT count(*) FROM agent_handoffs
                        WHERE run_id = ?
                          AND from_activation_id = ANY(?)
                          AND to_activation_id = ANY(?)
                          AND contract_hash = ?"""
                ).use { st ->
                    st.setObject(1, runId)
                    st.setArray(2, conn.createArrayOf("uuid", fromAgentActivationIds.toTypedArray()))
                    st.setArray(3, conn.createArrayOf("uuid", toAgentActivationIds.toTypedArray()))
                    st.setString(4, contractHash)
                    st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                }
            }
        }.getOrElse {
            log.warn("[handoff] repeat count failed run={}: {}", runId, it.message)
            /*
             * Zero, not "assume the worst".
             *
             * Failing closed here would stop a legitimate delegation because a
             * COUNT query hiccuped, and the runaway case this guard exists for is
             * already bounded twice over: the budget tree debits the parent for
             * everything its children spend, and the depth and activation-count
             * guards do not depend on this query. A degraded loop guard costs
             * budget; a fail-closed one costs the run.
             */
            0
        }
    }

    /**
     * Every activation in this run for a given agent.
     *
     * The loop guard is about the (from-agent, to-agent, contract) triple, but the
     * table stores ACTIVATION ids — and A→B→A→B creates a new activation for each
     * hop, so counting on activation ids alone would find one row each time and
     * never trip. Resolving the target agent to all of its activations in this run
     * is what makes the guard see the repeat.
     */
    fun activationsOfAgent(runId: UUID, agentId: UUID): List<UUID> {
        val ds = dataSource ?: return emptyList()
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT id FROM agent_activations WHERE run_id=? AND agent_id=?"
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, agentId)
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<UUID>()
                        while (rs.next()) out += rs.getObject(1, UUID::class.java)
                        out
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    /** Every edge in a run, oldest first — the constellation view's query. */
    fun forRun(runId: UUID): List<Edge> {
        val ds = dataSource ?: return emptyList()
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, from_activation_id, to_activation_id, kind, reason,
                              contract_hash, context_version, join_group_id
                         FROM agent_handoffs WHERE run_id=? ORDER BY created_at, id"""
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<Edge>()
                        while (rs.next()) out += Edge(
                            id = rs.getObject("id", UUID::class.java),
                            from = rs.getObject("from_activation_id", UUID::class.java),
                            to = rs.getObject("to_activation_id", UUID::class.java),
                            kind = rs.getString("kind"),
                            reason = rs.getString("reason"),
                            contractHash = rs.getString("contract_hash"),
                            contextVersion = rs.getLong("context_version"),
                            joinGroupId = rs.getObject("join_group_id", UUID::class.java),
                        )
                        out
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    data class Edge(
        val id: UUID,
        val from: UUID?,
        val to: UUID,
        val kind: String,
        val reason: String?,
        val contractHash: String,
        val contextVersion: Long,
        /** Non-null for a BROADCAST's children; shared across the fan-out. */
        val joinGroupId: UUID? = null,
    )
}
