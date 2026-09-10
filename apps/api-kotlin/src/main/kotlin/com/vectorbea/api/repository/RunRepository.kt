package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.getJsonbStringOrNull
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class CreateRunRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID,
    val workflowVersionId: UUID,
    val triggerType: String,
    val inputJson: String = "{}",
    val idempotencyKey: String? = null,
    /**
     * At most one LIVE run per (workspace, workflow, key).
     *
     * A different question from [idempotencyKey], and the difference is at the
     * boundary: an idempotency key asks "is this the same request" and expires
     * on a clock; this asks "is something already working on this thing" and
     * lives exactly as long as the run does. Enforced by a partial unique index
     * (V068), not by a check here — two alerts for one service in the same
     * second is the normal case, and a read-then-write loses that race.
     */
    val dedupKey: String? = null,
    /**
     * The self-hosted runner pool this run must execute in, copied from the
     * workflow at trigger.
     *
     * ── STAMPED, NOT JOINED ──────────────────────────────────────
     * So that unpinning a workflow does not retroactively move runs that are
     * already queued out of the customer's network, and so the platform claim
     * reads one column rather than joining `workflows` on its hottest query.
     *
     * Non-null means the platform's own workers will NOT claim it — see the
     * `runner_pool_id IS NULL` predicate in `PostgresClaim`.
     */
    val runnerPoolId: java.util.UUID? = null,
    /** True for "Debug Run" — instructs the worker to capture per-node debug snapshots. */
    val debugMode: Boolean = false,
    /**
     * Which worker pool and typed stream this run belongs to, decided at trigger
     * from the workflow version's graph. Materialising it here is what lets the
     * worker consume a stream it knows it can serve, instead of reading first
     * and discovering afterwards. Defaults to "short" — the smallest claim.
     */
    val executionClass: String = "short",
    /**
     * Virtual finish time from weighted fair queueing — the run's place in the
     * claim order. 0.0 means "not placed", which the claim treats as the front of
     * the queue, so callers that skip placement must pass a real value.
     */
    val fairVtime: Double = 0.0,
    /** 0 = ordinary traffic, 100 = priority/demo lane. */
    val priority: Short = 0,
    /**
     * Which of the three operations produced this run: live | replay | retry |
     * rerun. The worker reads this from the row to decide whether to serve model
     * calls from a recording or make them for real.
     */
    val executionModeKind: String = "live",
    /** The run being replayed or re-run from. Null for a fresh trigger. */
    val sourceRunId: UUID? = null,
    /** Partial replay: replayed up to and including this node, live after it. */
    val replayUntilNode: String? = null,
)

data class AgentRun(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID,
    val workflowVersionId: UUID,
    val status: String,
    val triggerType: String,
    val inputJson: String,
    val outputJson: String?,
    val errorJson: String?,
    val currentStepId: String?,
    val currentAgentId: UUID?,
    val idempotencyKey: String?,
    val startedAt: Instant?,
    val completedAt: Instant?,
    val durationMs: Long?,
    val tokenCount: Int?,
    val estimatedCost: Double?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val debugMode: Boolean = false,
    val nodeTotal: Int? = null,
    val nodeCommitted: Int = 0,
    val ribbonJson: String = "[]",
    /** The live-singleton key this run holds, or null. See [CreateRunRequest.dedupKey]. */
    val dedupKey: String? = null,
    /** The self-hosted runner pool this run executes in, if any. */
    val runnerPoolId: java.util.UUID? = null,
    /**
     * True when this run's payloads never left the customer's network.
     *
     * Read by the run detail and the Debug tab so they can SAY so. Without it
     * they render an empty panel, which reads as a broken product rather than
     * as the policy the customer deliberately bought.
     */
    val payloadsWithheld: Boolean = false,
    /**
     * Whether the run's result reached where it was meant to go.
     *
     * `none` | `pending` | `delivered` | `partial` | `failed`. Deliberately NOT
     * folded into [status]: a run that produced the right answer and could not
     * deliver it did not fail — its output is correct and retrying the RUN would
     * re-execute every side effect. Two facts, two columns. See docs/RESULT-DELIVERY.md.
     */
    val deliveryStatus: String = "none",
    /** Populated by list(); null for point reads and newly-created rows. */
    val workflowName: String? = null,
    val environmentName: String? = null,
    val incidentId: UUID? = null,
)

open class RunRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(RunRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, workflow_id, workflow_version_id,
        status, trigger_type, input_json, output_json, error_json,
        current_step_id, current_agent_id, idempotency_key,
        started_at, completed_at, duration_ms, token_count, estimated_cost,
        created_at, updated_at, debug_mode,
        node_total, node_committed, ribbon_json, delivery_status, dedup_key,
        runner_pool_id, COALESCE(payloads_withheld, FALSE) AS payloads_withheld
    """.trimIndent()

    /**
     * The run's stored execution class, for routing a RESUME_RUN / RETRY_NODE /
     * REPLAY_RUN onto the right typed stream.
     *
     * Read rather than re-derived on purpose: the class was decided once, at
     * trigger, from the version's graph. Re-deriving it on resume would risk a
     * continuation landing on a different stream from the run it continues —
     * and would reintroduce exactly the graph probe that typing the queue exists
     * to delete.
     *
     * Null means the run does not exist. Callers treat that as "short".
     */
    open fun findExecutionClass(runId: UUID): String? = queryOne(
        "SELECT execution_class FROM agent_runs WHERE id = ?",
        { setUuid(1, runId) },
    ) { rs -> rs.getString("execution_class") }

    open fun findById(id: UUID, workspaceId: UUID): AgentRun? = queryOne(
        "SELECT $cols FROM agent_runs WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    /**
     * Create a new run row with status='queued'.
     * The id is generated by the DB (uuid_generate_v4() default or gen_random_uuid()).
     */
    open fun create(req: CreateRunRequest): AgentRun = executeReturning(
        """
        INSERT INTO agent_runs
            (workspace_id, environment_id, workflow_id, workflow_version_id,
             status, trigger_type, input_json, idempotency_key, debug_mode,
             execution_class, fair_vtime, priority,
             execution_mode_kind, source_run_id, replay_until_node, dedup_key,
             runner_pool_id, payloads_withheld)
        VALUES (?, ?, ?, ?, 'queued', ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setUuid(3, req.workflowId)
            setUuid(4, req.workflowVersionId)
            setString(5, req.triggerType)
            setString(6, req.inputJson)
            setString(7, req.idempotencyKey)
            setBoolean(8, req.debugMode)
            setString(9, req.executionClass)
            setDouble(10, req.fairVtime)
            setShort(11, req.priority)
            setString(12, req.executionModeKind)
            setUuidOrNull(13, req.sourceRunId)
            setString(14, req.replayUntilNode)
            setString(15, req.dedupKey)
            setUuidOrNull(16, req.runnerPoolId)
            /*
             * Set at CREATION, not when the run finishes. The Debug tab has to
             * be able to say "payloads are withheld for this run" while it is
             * still executing — which is exactly when somebody opens it to find
             * out why they cannot see anything.
             */
            setBoolean(17, req.runnerPoolId != null)
        },
        ::mapRow,
    )

    /**
     * Find a run by idempotency key within a workspace.
     * Used to detect duplicate trigger requests.
     */
    open fun findByIdempotencyKey(workspaceId: UUID, idempotencyKey: String): AgentRun? = queryOne(
        "SELECT $cols FROM agent_runs WHERE workspace_id = ? AND idempotency_key = ? ORDER BY created_at DESC LIMIT 1",
        { setUuid(1, workspaceId); setString(2, idempotencyKey) },
        ::mapRow,
    )

    /**
     * Mark a run's status.  Used to set enqueue_failed if Redis write fails.
     */
    open fun updateStatus(id: UUID, workspaceId: UUID, status: String): Boolean =
        execute(
            "UPDATE agent_runs SET status = ?, updated_at = now() WHERE id = ? AND workspace_id = ?",
        ) {
            setString(1, status)
            setUuid(2, id)
            setUuid(3, workspaceId)
        } > 0

    /** Cancel every queued run in a workspace without deleting its audit trail. */
    open fun purgeQueued(workspaceId: UUID): Int = execute(
        """
        UPDATE agent_runs
           SET status = 'cancelled',
               completed_at = COALESCE(completed_at, now()),
               duration_ms = COALESCE(duration_ms, 0),
               updated_at = now()
         WHERE workspace_id = ? AND status = 'queued'
        """.trimIndent(),
    ) { setUuid(1, workspaceId) }

    open fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        workflowId: UUID? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<AgentRun> {
        val filters = buildList {
            add("r.workspace_id = ?")
            if (environmentId != null) add("r.environment_id = ?")
            if (workflowId != null) add("r.workflow_id = ?")
            if (status != null) add("r.status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (environmentId != null) it.setUuid(i++, environmentId)
            if (workflowId != null) it.setUuid(i++, workflowId)
            if (status != null) it.setString(i++, status)
        }
        return queryPage(
            sql = """
                SELECT r.*, w.name AS workflow_name,
                       COALESCE(e.slug, e.type) AS environment_name,
                       fi.id AS incident_id,
                       COALESCE(usage.total_tokens, r.token_count::bigint) AS effective_token_count,
                       COALESCE(usage.total_cost, r.estimated_cost) AS effective_estimated_cost
                  FROM agent_runs r
                  JOIN workflows w
                    ON w.id = r.workflow_id AND w.workspace_id = r.workspace_id
                  LEFT JOIN environments e
                    ON e.id = r.environment_id AND e.workspace_id = r.workspace_id
                  LEFT JOIN LATERAL (
                      SELECT id
                        FROM failure_incidents
                       WHERE workspace_id = r.workspace_id AND run_id = r.id
                       ORDER BY detected_at DESC
                       LIMIT 1
                  ) fi ON true
                  LEFT JOIN LATERAL (
                      SELECT SUM(token_count)::bigint AS total_tokens,
                             SUM(estimated_cost)::numeric AS total_cost
                        FROM run_events
                       WHERE run_id = r.id
                  ) usage ON true
                  $where
                 ORDER BY r.created_at DESC
            """.trimIndent(),
            countSql = "SELECT COUNT(*) FROM agent_runs r $where",
            params = params,
            bind = { bindBase(this) },
            mapRow = ::mapListRow,
        )
    }

    private fun mapListRow(rs: java.sql.ResultSet): AgentRun = mapRow(rs).copy(
        workflowName = rs.getString("workflow_name"),
        environmentName = rs.getString("environment_name"),
        incidentId = rs.uuidOrNull("incident_id"),
        tokenCount = (rs.getObject("effective_token_count") as? Number)?.toInt(),
        estimatedCost = (rs.getObject("effective_estimated_cost") as? Number)?.toDouble(),
    )

    private fun mapRow(rs: java.sql.ResultSet) = AgentRun(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        workflowId = rs.uuid("workflow_id"),
        workflowVersionId = rs.uuid("workflow_version_id"),
        status = rs.getString("status"),
        triggerType = rs.getString("trigger_type"),
        inputJson = rs.getJsonbString("input_json"),
        outputJson = rs.getJsonbStringOrNull("output_json"),
        errorJson = rs.getJsonbStringOrNull("error_json"),
        currentStepId = rs.getString("current_step_id"),
        currentAgentId = rs.uuidOrNull("current_agent_id"),
        idempotencyKey = rs.getString("idempotency_key"),
        startedAt = rs.instantOrNull("started_at"),
        completedAt = rs.instantOrNull("completed_at"),
        durationMs = rs.getObject("duration_ms") as? Long,
        tokenCount = rs.getObject("token_count") as? Int,
        estimatedCost = (rs.getObject("estimated_cost") as? java.math.BigDecimal)?.toDouble(),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
        debugMode = rs.getBoolean("debug_mode"),
        nodeTotal = (rs.getObject("node_total") as? Number)?.toInt(),
        nodeCommitted = rs.getInt("node_committed"),
        ribbonJson = rs.getJsonbString("ribbon_json"),
        /* `runCatching` for the same reason the other optional columns have it:
           several queries in this repository project a narrower column list and
           share this mapper. A missing column there means "not selected". */
        deliveryStatus = runCatching { rs.getString("delivery_status") }.getOrNull() ?: "none",
        dedupKey = runCatching { rs.getString("dedup_key") }.getOrNull(),
        runnerPoolId = runCatching {
            rs.getObject("runner_pool_id", java.util.UUID::class.java)
        }.getOrNull(),
        payloadsWithheld = runCatching { rs.getBoolean("payloads_withheld") }.getOrDefault(false),
    )
}
