package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.setJsonb
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

// ── Workflow ──────────────────────────────────────────────────────────────────

data class Workflow(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val creationMode: String,
    val status: String,
    val currentVersionId: UUID?,
    val createdAt: Instant,
    val updatedAt: Instant,
    /**
     * What a second start does when this workflow's dedup key is already held by
     * a live run: `reject` | `join` | `supersede`.
     *
     * The customer's choice, because only they know whether a second alert for a
     * service is more information about the same incident or a reason to start
     * again. Defaults to `reject` — the one that cannot silently do the wrong
     * thing, since the caller always learns what happened.
     */
    /**
     * The self-hosted runner pool this workflow executes in, if any.
     *
     * Declared on the WORKFLOW rather than on the run, because "this workflow
     * touches customer data and must execute inside our network" is a property
     * of the work. A trigger cannot move a run out of the customer's perimeter
     * by asking nicely.
     */
    val runnerPoolId: UUID? = null,
    val dedupPolicy: String = "reject",
    /** The signal name a joined input arrives under. The run has to be listening for it. */
    val dedupJoinSignal: String = "dedup_join",
    /** 0 = batch, 50 = normal, 100 = the priority lane. */
    val defaultPriority: Short = 0,
)

data class CreateWorkflowRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String? = null,
    val creationMode: String = "native",
    val status: String = "draft",
)

data class UpdateWorkflowRequest(
    val name: String? = null,
    val description: String? = null,
    val status: String? = null,
    /**
     * What a second start does when the run's deduplication key is taken:
     * `reject`, `join` or `supersede`. The WORKFLOW's choice, not the caller's —
     * only the person who wrote the workflow knows whether a second alert is
     * more information about the same incident or a reason to start again.
     */
    val dedupPolicy: String? = null,
    /** The signal name a `join` arrives under. The run has to be listening for it. */
    val dedupJoinSignal: String? = null,
    /** 0–100. Every run of this workflow starts here unless a trigger raises it. */
    val defaultPriority: Short? = null,
)

// ── WorkflowVersion ───────────────────────────────────────────────────────────

/**
 * Immutable snapshot of a workflow graph.
 * graph_json is the authoritative DAG definition — never contains secrets.
 */
data class WorkflowVersion(
    val id: UUID,
    val workflowId: UUID,
    val version: Int,
    val graphJson: String,
    val inputSchemaJson: String,
    val outputSchemaJson: String,
    val triggerConfigJson: String,
    val retryPolicyJson: String,
    val timeoutPolicyJson: String,
    val budgetPolicyJson: String,
    val replaySupport: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateWorkflowVersionRequest(
    val workflowId: UUID,
    val graph: Map<String, Any>,
    val inputSchema: Map<String, Any> = emptyMap(),
    val outputSchema: Map<String, Any> = emptyMap(),
    val triggerConfig: Map<String, Any> = emptyMap(),
    val retryPolicy: Map<String, Any> = emptyMap(),
    val timeoutPolicy: Map<String, Any> = emptyMap(),
    val budgetPolicy: Map<String, Any> = emptyMap(),
    val replaySupport: String = "full",
)

// ── Repository ────────────────────────────────────────────────────────────────

open class WorkflowRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(WorkflowRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, slug, description, creation_mode,
        status, current_version_id, created_at, updated_at,
        dedup_policy, dedup_join_signal, default_priority, runner_pool_id
    """.trimIndent()

    private val vCols = """
        id, workflow_id, version, graph_json, input_schema_json, output_schema_json,
        trigger_config_json, retry_policy_json, timeout_policy_json,
        budget_policy_json, replay_support, created_at, updated_at
    """.trimIndent()

    // ── Workflow CRUD ─────────────────────────────────────────────────────────

    open fun findById(id: UUID, workspaceId: UUID): Workflow? = queryOne(
        "SELECT $cols FROM workflows WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun findBySlug(slug: String, workspaceId: UUID): Workflow? = queryOne(
        "SELECT $cols FROM workflows WHERE slug = ? AND workspace_id = ?",
        { setString(1, slug); setUuid(2, workspaceId) },
        ::mapRow,
    )

    /**
     * Workflow row enriched with current-version graph_json for node counting.
     * graphJson is null when there is no current version.
     */
    data class WorkflowWithGraph(val workflow: Workflow, val graphJson: String?)

    /**
     * Same as [list] but LEFT JOINs workflow_versions to retrieve graph_json.
     * Used by the list API to compute step/agent/tool counts in one query.
     */
    fun listWithGraph(
        workspaceId: UUID,
        environmentId: UUID? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<WorkflowWithGraph> {
        val filters = buildList {
            add("w.workspace_id = ?")
            if (environmentId != null) add("w.environment_id = ?")
            if (status != null) add("w.status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (environmentId != null) it.setUuid(i++, environmentId)
            if (status != null) it.setString(i++, status)
        }
        val colsAliased = cols.split(",").joinToString(", ") { "w.${it.trim()}" }
        return queryPage(
            sql = """
                SELECT $colsAliased, v.graph_json AS graph_json_v
                FROM workflows w
                LEFT JOIN workflow_versions v ON v.id = w.current_version_id
                $where ORDER BY w.created_at DESC
            """.trimIndent(),
            countSql = "SELECT COUNT(*) FROM workflows w $where",
            params = params,
            bind = { bindBase(this) },
            mapRow = { rs ->
                WorkflowWithGraph(
                    workflow  = mapRow(rs),
                    graphJson = runCatching { rs.getString("graph_json_v") }.getOrNull(),
                )
            },
        )
    }

    fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<Workflow> {
        val filters = buildList {
            add("workspace_id = ?")
            if (environmentId != null) add("environment_id = ?")
            if (status != null) add("status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (environmentId != null) it.setUuid(i++, environmentId)
            if (status != null) it.setString(i++, status)
        }
        return queryPage(
            sql = "SELECT $cols FROM workflows $where ORDER BY created_at DESC",
            countSql = "SELECT COUNT(*) FROM workflows $where",
            params = params,
            bind = { bindBase(this) },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateWorkflowRequest): Workflow = executeReturning(
        """
        INSERT INTO workflows (workspace_id, environment_id, name, slug, description, creation_mode, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setString(3, req.name)
            setString(4, req.slug)
            setString(5, req.description)
            setString(6, req.creationMode)
            setString(7, req.status)
        },
        ::mapRow,
    )

    fun update(id: UUID, workspaceId: UUID, req: UpdateWorkflowRequest): Workflow? {
        val setClauses = buildList {
            if (req.name != null) add("name = ?")
            if (req.description != null) add("description = ?")
            if (req.status != null) add("status = ?")
            if (req.dedupPolicy != null) add("dedup_policy = ?")
            if (req.dedupJoinSignal != null) add("dedup_join_signal = ?")
            if (req.defaultPriority != null) add("default_priority = ?")
            add("updated_at = now()")
        }
        if (setClauses.size == 1) return findById(id, workspaceId) // nothing to update
        return queryOne(
            "UPDATE workflows SET ${setClauses.joinToString(", ")} WHERE id = ? AND workspace_id = ? RETURNING $cols",
            {
                var i = 1
                if (req.name != null) setString(i++, req.name)
                if (req.description != null) setString(i++, req.description)
                if (req.status != null) setString(i++, req.status)
                if (req.dedupPolicy != null) setString(i++, req.dedupPolicy)
                if (req.dedupJoinSignal != null) setString(i++, req.dedupJoinSignal)
                if (req.defaultPriority != null) setShort(i++, req.defaultPriority)
                setUuid(i++, id)
                setUuid(i, workspaceId)
            },
            ::mapRow,
        )
    }

    fun setCurrentVersion(id: UUID, workspaceId: UUID, versionId: UUID): Workflow? = queryOne(
        "UPDATE workflows SET current_version_id = ?, updated_at = now() WHERE id = ? AND workspace_id = ? RETURNING $cols",
        { setUuid(1, versionId); setUuid(2, id); setUuid(3, workspaceId) },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM workflows WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    // ── Workflow version CRUD ─────────────────────────────────────────────────

    fun findVersionById(versionId: UUID): WorkflowVersion? = queryOne(
        "SELECT $vCols FROM workflow_versions WHERE id = ?",
        { setUuid(1, versionId) },
        ::mapVersionRow,
    )

    // ── Execution class memo (V020) ───────────────────────────────────────────
    //
    // A version's graph is immutable, so its execution class is too. These two
    // methods are the durable half of the classification memo: computed once by
    // whichever API instance first triggers the version, then read by every
    // other instance — including cold ones with an empty in-process cache.
    // Deliberately narrow reads/writes of a single column rather than going
    // through the full version row, since this sits on the trigger hot path.

    /** Persisted class for [versionId], or null when it has never been classified. */
    fun findVersionExecutionClass(versionId: UUID): String? = queryOne(
        "SELECT execution_class FROM workflow_versions WHERE id = ?",
        { setUuid(1, versionId) },
    ) { rs -> rs.getString("execution_class") }

    /**
     * Memoise [executionClass] for [versionId].
     *
     * `IS NULL` in the predicate makes this write-once: two instances racing on
     * the first trigger of a version both compute the same value (the classifier
     * is pure), and the loser's UPDATE simply affects zero rows.
     */
    fun setVersionExecutionClass(versionId: UUID, executionClass: String): Boolean =
        execute(
            "UPDATE workflow_versions SET execution_class = ? WHERE id = ? AND execution_class IS NULL"
        ) {
            setString(1, executionClass)
            setUuid(2, versionId)
        } > 0

    fun listVersions(workflowId: UUID, params: PageParams = PageParams()): Page<WorkflowVersion> = queryPage(
        sql = "SELECT $vCols FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC",
        countSql = "SELECT COUNT(*) FROM workflow_versions WHERE workflow_id = ?",
        params = params,
        bind = { setUuid(1, workflowId) },
        mapRow = ::mapVersionRow,
    )

    fun nextVersionNumber(workflowId: UUID): Int =
        query("SELECT COALESCE(MAX(version), 0) + 1 FROM workflow_versions WHERE workflow_id = ?",
            { setUuid(1, workflowId) }) { rs -> rs.getInt(1) }.first()

    fun createVersion(req: CreateWorkflowVersionRequest): WorkflowVersion {
        val versionNum = nextVersionNumber(req.workflowId)
        return executeReturning(
            """
            INSERT INTO workflow_versions (
                workflow_id, version, graph_json, input_schema_json, output_schema_json,
                trigger_config_json, retry_policy_json, timeout_policy_json,
                budget_policy_json, replay_support
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING $vCols
            """.trimIndent(),
            {
                setUuid(1, req.workflowId)
                setInt(2, versionNum)
                setJsonb(3, req.graph)
                setJsonb(4, req.inputSchema)
                setJsonb(5, req.outputSchema)
                setJsonb(6, req.triggerConfig)
                setJsonb(7, req.retryPolicy)
                setJsonb(8, req.timeoutPolicy)
                setJsonb(9, req.budgetPolicy)
                setString(10, req.replaySupport)
            },
            ::mapVersionRow,
        )
    }

    // ── Row mappers ───────────────────────────────────────────────────────────

    private fun mapRow(rs: java.sql.ResultSet) = Workflow(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        description = rs.getString("description"),
        creationMode = rs.getString("creation_mode"),
        status = rs.getString("status"),
        currentVersionId = rs.uuidOrNull("current_version_id"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
        /* `runCatching` like the other optional columns: several queries in this
           repository project a narrower list and share this mapper, where a
           missing column means "not selected" rather than "not present". */
        dedupPolicy = runCatching { rs.getString("dedup_policy") }.getOrNull() ?: "reject",
        dedupJoinSignal = runCatching { rs.getString("dedup_join_signal") }.getOrNull()
            ?: "dedup_join",
        defaultPriority = runCatching { rs.getShort("default_priority") }.getOrDefault(0),
        runnerPoolId = runCatching { rs.getObject("runner_pool_id", UUID::class.java) }.getOrNull(),
    )

    private fun mapVersionRow(rs: java.sql.ResultSet) = WorkflowVersion(
        id = rs.uuid("id"),
        workflowId = rs.uuid("workflow_id"),
        version = rs.getInt("version"),
        graphJson = rs.getJsonbString("graph_json"),
        inputSchemaJson = rs.getJsonbString("input_schema_json"),
        outputSchemaJson = rs.getJsonbString("output_schema_json"),
        triggerConfigJson = rs.getJsonbString("trigger_config_json"),
        retryPolicyJson = rs.getJsonbString("retry_policy_json"),
        timeoutPolicyJson = rs.getJsonbString("timeout_policy_json"),
        budgetPolicyJson = rs.getJsonbString("budget_policy_json"),
        replaySupport = rs.getString("replay_support"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
