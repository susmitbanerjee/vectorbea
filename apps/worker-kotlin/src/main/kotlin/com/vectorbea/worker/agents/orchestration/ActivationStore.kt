package com.vectorbea.worker.agents.orchestration

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.observability.keys.CanonicalJson
import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Create-or-reattach for activations, and the status machine over them.
 *
 * THE ONE THING THIS CLASS EXISTS TO GET RIGHT
 * --------------------------------------------
 * A resumed run must reattach to the activation it already created and return
 * that row's recorded output. It must not create a second. There is no error if
 * it does — the run still completes — so the failure is silent, shows up as a
 * duplicated subtree in the trace, and would eventually double-count every
 * budget in the system.
 */
class ActivationStore(private val dataSource: DataSource?) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /** §4.1's vocabulary. Terminal states end an activation; the rest do not. */
    enum class Status(val wire: String, val terminal: Boolean) {
        PENDING("pending", false),
        RUNNING("running", false),
        WAITING_FOR_CHILD("waiting_for_child", false),
        WAITING_FOR_APPROVAL("waiting_for_approval", false),
        /* Neither success nor failure, deliberately: a router that correctly
           transferred to a specialist did its job. Grading it succeeded inflates
           success metrics; grading it failed makes every routed run look broken.
           Unreachable until P7. */
        HANDED_OFF("handed_off", true),
        SUCCEEDED("succeeded", true),
        FAILED("failed", true),
        CANCELLED("cancelled", true),
        SUPERSEDED("superseded", true),
    }

    data class Activation(
        val id: UUID,
        val runId: UUID,
        val stepId: String,
        val agentId: UUID,
        val sequence: Int,
        val status: String,
        val idempotencyKey: String,
        /**
         * The instruction AS RESOLVED at first creation.
         *
         * This row is the authority, not the fallback chain that produced it.
         * See [createOrReattach].
         */
        val taskInstruction: String?,
        /** The pinned agent definition. Null on a row written before pinning. */
        val agentSnapshot: Map<String, Any?>?,
        val outputJson: String?,
        val stopReason: String?,
        val attempt: Int,
        /** True when this call found an existing row rather than inserting one. */
        val reattached: Boolean,
    )

    /**
     * The idempotency key, per §4.
     *
     * `(parent_activation_id ?: step_id) | agent_id | canonical_json(contract)`.
     *
     * `step_id` and `agent_id` are in the hash and not merely alongside it: with
     * the contract reduced to a task instruction, they are the ONLY thing
     * separating two agent nodes in one graph that were handed the same
     * instruction. Drop them and those two collide onto one activation.
     */
    fun idempotencyKey(
        parentActivationId: UUID?,
        stepId: String,
        agentId: UUID,
        contract: Map<String, Any?>,
    ): String = CanonicalJson.keyOf(
        parentActivationId?.toString() ?: stepId,
        agentId.toString(),
        contract,
    )

    /**
     * Find this activation or create it.
     *
     * ── WHY THE LOOKUP IS BY THE NATURAL KEY AND NOT BY THE HASH ────────────
     *
     * The obvious implementation computes the idempotency key from the contract
     * and selects on it. That works only if the contract is byte-identical on
     * every tick, and for a ROOT activation it is not guaranteed to be: the task
     * instruction falls back through node config → `taskInstruction` → `task` →
     * `prompt` → `input`, and if the field the fallback landed on is absent on a
     * later tick, the chain resolves somewhere else and the hash moves. A moved
     * hash means no row matches, and a second activation is created for the same
     * work.
     *
     * So for a root activation the lookup is by `(run_id, step_id, agent_id)`,
     * which cannot drift, and the STORED `task_instruction` becomes the authority
     * for everything downstream. The freshly-resolved instruction is used only
     * when there is no row yet.
     *
     * The unique constraint on the hash is still load-bearing — it is what stops
     * two workers racing the same insert — but it is the guard, not the lookup.
     * P7's children reattach by hash, because a delegated contract is constructed
     * by the parent and is stable by construction.
     */
    fun createOrReattach(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        stepId: String,
        agentId: UUID,
        resolvedTaskInstruction: String?,
        agentSnapshot: Map<String, Any?>,
        agentVersion: String?,
        budgetAllocated: Map<String, Any?>,
    ): Activation? {
        val ds = dataSource ?: return null
        return try {
            existingRoot(ds, runId, stepId, agentId)?.let { return it.copy(reattached = true) }

            val contract = mapOf("taskInstruction" to resolvedTaskInstruction)
            val key = idempotencyKey(null, stepId, agentId, contract)
            val id = UUID.randomUUID()

            ds.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_activations
                       (id, run_id, workspace_id, environment_id, step_id,
                        parent_activation_id, root_activation_id, depth, sequence,
                        agent_id, agent_version, agent_snapshot_json, status,
                        contract_json, budget_allocated_json, idempotency_key, started_at)
                       VALUES (?,?,?,?,?,NULL,?,0,
                               (SELECT COALESCE(MAX(sequence),0)+1 FROM agent_activations WHERE run_id = ?),
                               ?,?,?::jsonb,'running',?::jsonb,?::jsonb,?,now())
                       ON CONFLICT (run_id, idempotency_key) DO NOTHING"""
                ).use { st ->
                    st.setObject(1, id); st.setObject(2, runId); st.setObject(3, workspaceId)
                    st.setObject(4, environmentId); st.setString(5, stepId)
                    /* A root activation is its own subtree root. */
                    st.setObject(6, id)
                    st.setObject(7, runId)
                    st.setObject(8, agentId); st.setString(9, agentVersion)
                    st.setString(10, mapper.writeValueAsString(agentSnapshot))
                    st.setString(11, mapper.writeValueAsString(contract))
                    st.setString(12, mapper.writeValueAsString(budgetAllocated))
                    st.setString(13, key)
                    st.executeUpdate()
                }
            }

            /* Re-read rather than trusting the insert: under a race the conflict
               did nothing and the winner's row is the one to use. */
            existingRoot(ds, runId, stepId, agentId)
        } catch (e: Exception) {
            log.warn("[activation] create/reattach failed run={} step={}: {}", runId, stepId, e.message)
            null
        }
    }

    /** Move an activation to a terminal state and record what it produced. */
    fun complete(
        activationId: UUID,
        status: Status,
        output: Map<String, Any?>?,
        stopReason: String?,
        failureClass: String?,
        budgetConsumed: Map<String, Any?>,
    ) {
        val ds = dataSource ?: return
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE agent_activations
                          SET status=?, output_json=?::jsonb, stop_reason=?, failure_class=?,
                              budget_consumed_json=?::jsonb,
                              ended_at = CASE WHEN ? THEN now() ELSE ended_at END
                        WHERE id=?"""
                ).use { st ->
                    st.setString(1, status.wire)
                    st.setString(2, output?.let { mapper.writeValueAsString(it) })
                    st.setString(3, stopReason)
                    st.setString(4, failureClass)
                    st.setString(5, mapper.writeValueAsString(budgetConsumed))
                    st.setBoolean(6, status.terminal)
                    st.setObject(7, activationId)
                    st.executeUpdate()
                }
            }
        }.onFailure {
            log.warn("[activation] status update failed id={}: {}", activationId, it.message)
        }
    }

    /** Park an activation without ending it — an open approval gate beneath it. */
    fun park(activationId: UUID, status: Status) {
        val ds = dataSource ?: return
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement("UPDATE agent_activations SET status=? WHERE id=?").use {
                    it.setString(1, status.wire); it.setObject(2, activationId); it.executeUpdate()
                }
            }
        }
    }

    /** Root activations on this run, for the duplicate-detection warning. */
    fun rootCount(runId: UUID): Int {
        val ds = dataSource ?: return 0
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT count(*) FROM agent_activations WHERE run_id=? AND parent_activation_id IS NULL"
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                }
            }
        }.getOrDefault(0)
    }

    @Suppress("UNCHECKED_CAST")
    private fun existingRoot(ds: DataSource, runId: UUID, stepId: String, agentId: UUID): Activation? =
        ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, sequence, status, idempotency_key, contract_json::text,
                          agent_snapshot_json::text, output_json::text, stop_reason, attempt
                     FROM agent_activations
                    WHERE run_id=? AND step_id=? AND agent_id=? AND parent_activation_id IS NULL
                    ORDER BY sequence LIMIT 1"""
            ).use { st ->
                st.setObject(1, runId); st.setString(2, stepId); st.setObject(3, agentId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else {
                        val contract = runCatching {
                            mapper.readValue(rs.getString("contract_json"), Map::class.java)
                                as Map<String, Any?>
                        }.getOrDefault(emptyMap())
                        Activation(
                            id = rs.getObject("id", UUID::class.java),
                            runId = runId, stepId = stepId, agentId = agentId,
                            sequence = rs.getInt("sequence"),
                            status = rs.getString("status"),
                            idempotencyKey = rs.getString("idempotency_key"),
                            taskInstruction = contract["taskInstruction"] as? String,
                            agentSnapshot = runCatching {
                                rs.getString("agent_snapshot_json")?.let {
                                    mapper.readValue(it, Map::class.java) as Map<String, Any?>
                                }
                            }.getOrNull(),
                            outputJson = rs.getString("output_json"),
                            stopReason = rs.getString("stop_reason"),
                            attempt = rs.getInt("attempt"),
                            reattached = false,
                        )
                    }
                }
            }
        }
}
