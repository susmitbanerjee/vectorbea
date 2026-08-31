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
/*
 * `open` so a test can pin the activation id the harness looks a budget clamp up
 * under. There is no code path that creates a leaf activation three levels down
 * until delegation lands, and a fully faked store would test the fake — this way
 * the insert, the status write and the reattach all still run for real.
 */
open class ActivationStore(private val dataSource: DataSource?) {
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
        val parentActivationId: UUID? = null,
        val depth: Int = 0,
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
    ) {
        /**
         * Whether this activation is FINISHED, and therefore whether reattaching to
         * it means replaying its recorded outcome or running it again.
         *
         * ── THE RESUME RULE, IN ONE SENTENCE ────────────────────────────────
         * Terminal: replay what it produced, run nothing. Non-terminal: run it.
         *
         * Every non-terminal status resolves to "run it", and that is a decision
         * rather than an oversight. A crash mid-delegation leaves the parent
         * `waiting_for_child` and the child `running` with nothing holding it, and
         * re-running is safe because the RUN LEASE already guarantees one worker
         * per run — the child's own step guards and idempotency keys then dedupe
         * its side effects exactly as they do on any other replay.
         *
         * | Status | On reattach |
         * |---|---|
         * | `pending`, `running` | Run it. The previous attempt did not finish. |
         * | `waiting_for_approval` | Run it; its own gate resolves the decision. |
         * | `waiting_for_child` | Run it; its own delegation re-issues and reattaches. |
         * | `succeeded`, `failed`, `handed_off`, `cancelled`, `superseded` | Replay the recorded outcome. |
         *
         * Replaying the terminal case is what makes a resume cheap: it is the
         * difference between a resumed supervisor re-running its worker's entire
         * brain loop and reading one row.
         */
        val terminal: Boolean
            get() = Status.entries.firstOrNull { it.wire == status }?.terminal ?: false
    }

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
    open fun createOrReattach(
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

    /**
     * Find or create a DELEGATED child activation.
     *
     * ── WHY THIS IS A SECOND METHOD AND NOT A PARAMETER ─────────────────────
     * It differs from [createOrReattach] in the one thing that matters: the
     * lookup. A root reattaches by the natural key `(run_id, step_id, agent_id)`
     * because its contract can drift — the task instruction falls through a
     * fallback chain that may resolve differently on a later tick. A CHILD
     * reattaches by the idempotency HASH, because a delegated contract is
     * constructed by the delegating agent: small, explicit, and stable by
     * construction rather than by luck.
     *
     * Sharing one method behind a flag would put two incompatible lookup rules in
     * one body, and the failure mode of picking the wrong one is silent — a second
     * activation for work that already has one, which nothing errors on.
     *
     * The same parent delegating the same contract to the same agent twice is one
     * activation, deliberately: that is the definition of the same work, and it is
     * what makes a resumed delegation cheap. Two genuinely different subtasks
     * differ in their contract and therefore in their hash.
     */
    fun createOrReattachChild(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        stepId: String,
        agentId: UUID,
        parentActivationId: UUID,
        rootActivationId: UUID,
        depth: Int,
        contract: Map<String, Any?>,
        agentSnapshot: Map<String, Any?>,
        agentVersion: String?,
        budgetAllocated: Map<String, Any?>,
        role: String = "worker",
    ): Activation? {
        val ds = dataSource ?: return null
        val key = idempotencyKey(parentActivationId, stepId, agentId, contract)
        return try {
            existingByKey(ds, runId, key)?.let { return it.copy(reattached = true) }

            val id = UUID.randomUUID()
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_activations
                       (id, run_id, workspace_id, environment_id, step_id,
                        parent_activation_id, root_activation_id, depth, sequence,
                        agent_id, agent_version, agent_snapshot_json, role, status,
                        contract_json, budget_allocated_json, idempotency_key, started_at)
                       VALUES (?,?,?,?,?,?,?,?,
                               (SELECT COALESCE(MAX(sequence),0)+1 FROM agent_activations WHERE run_id = ?),
                               ?,?,?::jsonb,?,'running',?::jsonb,?::jsonb,?,now())
                       ON CONFLICT (run_id, idempotency_key) DO NOTHING"""
                ).use { st ->
                    st.setObject(1, id); st.setObject(2, runId); st.setObject(3, workspaceId)
                    st.setObject(4, environmentId); st.setString(5, stepId)
                    st.setObject(6, parentActivationId); st.setObject(7, rootActivationId)
                    st.setInt(8, depth)
                    st.setObject(9, runId)
                    st.setObject(10, agentId); st.setString(11, agentVersion)
                    st.setString(12, mapper.writeValueAsString(agentSnapshot))
                    st.setString(13, role)
                    st.setString(14, mapper.writeValueAsString(contract))
                    st.setString(15, mapper.writeValueAsString(budgetAllocated))
                    st.setString(16, key)
                    st.executeUpdate()
                }
            }
            /* Re-read rather than trusting the insert: under a race the conflict
               did nothing and the winner's row is the one to use. */
            existingByKey(ds, runId, key)
        } catch (e: Exception) {
            log.warn("[activation] child create/reattach failed run={} parent={}: {}",
                runId, parentActivationId, e.message)
            null
        }
    }

    /** Activations in this run, for the §9 total-activations guard. */
    fun countInRun(runId: UUID): Int {
        val ds = dataSource ?: return 0
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement("SELECT count(*) FROM agent_activations WHERE run_id=?").use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                }
            }
        }.getOrDefault(0)
    }

    /** One activation by id, for reading a parent's depth and lineage. */
    fun byId(id: UUID): Activation? {
        val ds = dataSource ?: return null
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(SELECT_COLUMNS + " WHERE id = ?").use { st ->
                    st.setObject(1, id)
                    st.executeQuery().use { rs -> if (rs.next()) readRow(rs) else null }
                }
            }
        }.getOrNull()
    }

    /**
     * This activation and every ancestor, nearest first.
     *
     * The reader lineage `RunContextStore` needs, and the chain a private
     * blackboard entry is checked against. Bounded by the depth guard; the visited
     * set makes a cycle in the parent chain terminate rather than hang.
     */
    fun lineageOf(id: UUID): List<UUID> {
        val out = mutableListOf<UUID>()
        var cursor: UUID? = id
        val seen = HashSet<UUID>()
        while (cursor != null && seen.add(cursor)) {
            out += cursor
            cursor = byId(cursor)?.parentActivationId
        }
        return out
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

    /**
     * One column list and one row reader, shared by every lookup.
     *
     * Three queries return an [Activation], and three hand-maintained mappings
     * drift. The way they drift is that one of them forgets a field that was added
     * later — `depth` and `parent_activation_id` are exactly the sort — and the
     * guard that reads it silently sees 0 and null, which for a DEPTH guard means
     * it never fires.
     */
    private val SELECT_COLUMNS = """SELECT id, run_id, step_id, agent_id, sequence, status,
                  parent_activation_id, depth, idempotency_key, contract_json::text,
                  agent_snapshot_json::text, output_json::text, stop_reason, attempt
             FROM agent_activations"""

    @Suppress("UNCHECKED_CAST")
    private fun readRow(rs: java.sql.ResultSet): Activation {
        val contract = runCatching {
            mapper.readValue(rs.getString("contract_json"), Map::class.java) as Map<String, Any?>
        }.getOrDefault(emptyMap())
        return Activation(
            id = rs.getObject("id", UUID::class.java),
            runId = rs.getObject("run_id", UUID::class.java),
            stepId = rs.getString("step_id"),
            agentId = rs.getObject("agent_id", UUID::class.java),
            sequence = rs.getInt("sequence"),
            status = rs.getString("status"),
            parentActivationId = rs.getObject("parent_activation_id", UUID::class.java),
            depth = rs.getInt("depth"),
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

    private fun existingRoot(ds: DataSource, runId: UUID, stepId: String, agentId: UUID): Activation? =
        ds.connection.use { conn ->
            conn.prepareStatement(
                SELECT_COLUMNS +
                " WHERE run_id=? AND step_id=? AND agent_id=? AND parent_activation_id IS NULL" +
                " ORDER BY sequence LIMIT 1"
            ).use { st ->
                st.setObject(1, runId); st.setString(2, stepId); st.setObject(3, agentId)
                st.executeQuery().use { rs -> if (rs.next()) readRow(rs) else null }
            }
        }

    /** The CHILD lookup: by the idempotency hash. See [createOrReattachChild]. */
    private fun existingByKey(ds: DataSource, runId: UUID, key: String): Activation? =
        ds.connection.use { conn ->
            conn.prepareStatement(SELECT_COLUMNS + " WHERE run_id=? AND idempotency_key=?").use { st ->
                st.setObject(1, runId); st.setString(2, key)
                st.executeQuery().use { rs -> if (rs.next()) readRow(rs) else null }
            }
        }
}
