package com.vectorbea.api.contract

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.audit.AuditLog
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.util.UUID
import javax.sql.DataSource

/**
 * Contract CRUD, draft inference, and the publish-time gate.
 *
 * `GET    /api/workflows/:id/contracts`              every node's contract
 * `GET    /api/workflows/:id/contracts/:nodeId`      one node's contract
 * `PUT    /api/workflows/:id/contracts/:nodeId`      author or replace it
 * `POST   /api/workflows/:id/contracts/:nodeId/infer` draft from history
 * `POST   /api/workflows/:id/contracts/:nodeId/test` evaluate against sample data
 * `GET    /api/workflows/:id/publish-readiness`      the R06 check
 *
 * THE PUBLISH GATE IS THE POINT
 * -----------------------------
 * §2 of the prompt: *"If a node declares a schema but the selected provider path
 * cannot enforce it, that is a PUBLISH-TIME VALIDATION ERROR, not a runtime
 * surprise."*
 *
 * A schema the provider cannot enforce is not a weaker guarantee, it is **no**
 * guarantee dressed as one — the author believes the output is constrained and it
 * is not. Catching it at publish means the author finds out while editing, with
 * the node in front of them, rather than from a production run at 2am.
 */
class ContractRoutes(
    private val dataSource: DataSource,
    private val audit: AuditLog? = null,
) {
    private val log = LoggerFactory.getLogger(ContractRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/workflows/:id/contracts") { req -> list(req) }
        router.get("/api/workflows/:id/contracts/:nodeId") { req -> getOne(req) }
        router.put("/api/workflows/:id/contracts/:nodeId") { req -> upsert(req) }
        router.post("/api/workflows/:id/contracts/:nodeId/infer") { req -> infer(req) }
        router.post("/api/workflows/:id/contracts/:nodeId/test") { req -> test(req) }
        router.get("/api/workflows/:id/publish-readiness") { req -> readiness(req) }
    }

    // ── Read ────────────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")
        val rows = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT node_id, version, content_hash, schema_json::text, assertions_json::text,
                          groundedness, status, source, decoding_enforced, decoding_note, created_at
                     FROM node_contracts
                    WHERE workflow_id = ? AND workspace_id = ? AND status IN ('active','draft')
                    ORDER BY node_id"""
            ).use { stmt ->
                stmt.setObject(1, workflowId); stmt.setObject(2, ctx.workspaceId)
                stmt.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) out += rowToMap(rs)
                    out
                }
            }
        }
        return Response.ok(mapOf("workflowId" to workflowId.toString(), "contracts" to rows))
    }

    private fun getOne(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")
        val nodeId = req.pathParam("nodeId")
        val row = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT node_id, version, content_hash, schema_json::text, assertions_json::text,
                          groundedness, status, source, decoding_enforced, decoding_note, created_at
                     FROM node_contracts
                    WHERE workflow_id = ? AND workspace_id = ? AND node_id = ?
                      AND status IN ('active','draft')
                    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END
                    LIMIT 1"""
            ).use { stmt ->
                stmt.setObject(1, workflowId); stmt.setObject(2, ctx.workspaceId); stmt.setString(3, nodeId)
                stmt.executeQuery().use { rs -> if (rs.next()) rowToMap(rs) else null }
            }
        } ?: throw ApiError.NotFound("Contract")
        return Response.ok(row)
    }

    // ── Write ───────────────────────────────────────────────────────────────

    data class ContractBody(
        val schema: Map<String, Any?>? = null,
        val assertions: List<Map<String, Any?>> = emptyList(),
        val groundedness: String = "none",
        val confidence: Map<String, Any?>? = null,
        /** The provider this node will use, so enforceability can be decided now. */
        val provider: String? = null,
        val model: String? = null,
    )

    /**
     * Author or replace a node's contract.
     *
     * A change creates a NEW VERSION and supersedes the old one; it never edits in
     * place. Historical runs must remain judgeable against the contract that was in
     * force when they ran, and editing would silently rewrite that judgement.
     *
     * An edit that produces the same content hash is a no-op — the same contract,
     * however it was authored, so the reliability baseline is not branched for a
     * whitespace change.
     */
    private fun upsert(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")
        val nodeId = req.pathParam("nodeId")
        val body = req.bodyAs<ContractBody>()

        // Validate before storing: a contract that cannot be evaluated is worse than
        // none, because the author believes they are protected.
        val problems = ContractLinter.lint(body.schema, body.assertions, body.provider)
        if (problems.any { it.blocking }) {
            throw ApiError.ValidationError(
                "This contract cannot be saved: " +
                    problems.filter { it.blocking }.joinToString("; ") { it.message }
            )
        }

        val canonical = canonicalise(body)
        val hash = sha256(canonical)

        val existing = activeContract(workflowId, ctx.workspaceId, nodeId)
        if (existing?.second == hash) {
            // Same meaning — nothing to do, and importantly no baseline branch.
            return Response.ok(mapOf(
                "nodeId" to nodeId, "version" to existing.first, "contentHash" to hash,
                "unchanged" to true,
                "message" to "The contract is unchanged; no new version was created.",
            ))
        }

        val enforced = body.provider?.let { ContractLinter.decodingEnforced(it) } ?: false
        val note = body.provider?.let { ContractLinter.decodingNote(it) }
        val nextVersion = (existing?.first ?: 0) + 1

        dataSource.connection.use { conn ->
            conn.autoCommit = false
            try {
                // Supersede, then insert. The partial unique index allows exactly one
                // active row per node, so the order matters.
                conn.prepareStatement(
                    """UPDATE node_contracts SET status = 'superseded'
                        WHERE workflow_id = ? AND node_id = ? AND status = 'active'"""
                ).use { it.setObject(1, workflowId); it.setString(2, nodeId); it.executeUpdate() }

                conn.prepareStatement(
                    """INSERT INTO node_contracts
                        (workspace_id, workflow_id, node_id, version, content_hash,
                         schema_json, assertions_json, groundedness, confidence_json,
                         decoding_enforced, decoding_note, source, status, created_by)
                       VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, ?, 'user', 'active', ?)"""
                ).use { stmt ->
                    stmt.setObject(1, ctx.workspaceId)
                    stmt.setObject(2, workflowId)
                    stmt.setString(3, nodeId)
                    stmt.setInt(4, nextVersion)
                    stmt.setString(5, hash)
                    stmt.setString(6, body.schema?.let { toJson(it) })
                    stmt.setString(7, toJson(body.assertions))
                    stmt.setString(8, body.groundedness)
                    stmt.setString(9, body.confidence?.let { toJson(it) })
                    stmt.setBoolean(10, enforced)
                    stmt.setString(11, note)
                    stmt.setString(12, req.principal?.appUserId?.toString())
                    stmt.executeUpdate()
                }
                conn.commit()
            } catch (e: Exception) {
                conn.rollback(); throw e
            } finally {
                conn.autoCommit = true
            }
        }

        audit?.recordUserAction(
            req, ctx.workspaceId, "contract.update", "node_contract",
            targetId = workflowId,
            before = existing?.let { mapOf("version" to it.first, "hash" to it.second) },
            after = mapOf("nodeId" to nodeId, "version" to nextVersion, "hash" to hash),
        )

        log.info("[contract] {}/{} -> v{} hash={} enforced={}", workflowId, nodeId, nextVersion, hash.take(12), enforced)
        return Response.ok(mapOf(
            "nodeId" to nodeId,
            "version" to nextVersion,
            "contentHash" to hash,
            "decodingEnforced" to enforced,
            "decodingNote" to note,
            "warnings" to problems.filter { !it.blocking }.map { it.message },
            "message" to "Contract v$nextVersion saved. Runs from now on are judged against it; " +
                "earlier runs keep the version that applied to them.",
        ))
    }

    // ── Draft inference (§7) ────────────────────────────────────────────────

    /**
     * Infer a draft from the node's own history.
     *
     * Stored with `status='draft'`, which the runtime ignores entirely. §7 is
     * explicit — *"never auto-apply"* — and the reason is sharp: a schema inferred
     * from 20 outputs describes what the node HAS produced, not what it SHOULD.
     * Enforcing that would fail runs for violating a rule nobody wrote.
     */
    private fun infer(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")
        val nodeId = req.pathParam("nodeId")

        val result = dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT infer_draft_contract(?, ?, ?, ?)::text").use { stmt ->
                stmt.setObject(1, ctx.workspaceId)
                stmt.setObject(2, workflowId)
                stmt.setString(3, nodeId)
                stmt.setInt(4, 50)
                stmt.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
            }
        } ?: throw ApiError.InternalError("Inference produced no result")

        @Suppress("UNCHECKED_CAST")
        val parsed = com.vectorbea.api.http.fromJson<Map<String, Any?>>(result)
        if (parsed["inferred"] != true) {
            return Response.ok(parsed + mapOf(
                "message" to "Not enough history to infer a contract for '$nodeId'. " +
                    "Run the workflow a few more times, or author the contract by hand.",
            ))
        }

        return Response.ok(parsed + mapOf(
            "status" to "draft",
            "applied" to false,
            "message" to "This is a DRAFT inferred from what '$nodeId' has produced before. " +
                "It is not in force. Review it — especially which fields are required — " +
                "then save it to apply.",
        ))
    }

    // ── Live testing (for the inspector) ────────────────────────────────────

    data class TestBody(
        val schema: Map<String, Any?>? = null,
        val assertions: List<Map<String, Any?>> = emptyList(),
        val sampleOutput: Any? = null,
        val sampleInput: Any? = null,
    )

    /**
     * Evaluate a contract against sample data without saving it.
     *
     * This is what makes the assertion builder usable: an author writes an
     * expression and sees immediately whether it holds against their last run,
     * rather than publishing and waiting.
     */
    private fun test(req: Request): Response {
        val body = req.bodyAs<TestBody>()
        val evaluation = ContractLinter.evaluate(
            schema = body.schema,
            assertions = body.assertions,
            input = body.sampleInput,
            output = body.sampleOutput,
        )
        return Response.ok(evaluation)
    }

    // ── Publish readiness (R06) ─────────────────────────────────────────────

    /**
     * The publish gate.
     *
     * Blocking problems prevent publish. Advisory ones do not — a node with no
     * contract keeps working, per §7, and is merely flagged.
     */
    private fun readiness(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")

        val graph = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT v.graph_json::text
                     FROM workflows w JOIN workflow_versions v ON v.id = w.current_version_id
                    WHERE w.id = ? AND w.workspace_id = ?"""
            ).use { stmt ->
                stmt.setObject(1, workflowId); stmt.setObject(2, ctx.workspaceId)
                stmt.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
            }
        } ?: throw ApiError.NotFound("Workflow")

        val contracts = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT node_id, schema_json IS NOT NULL AS has_schema,
                          decoding_enforced, decoding_note, version
                     FROM node_contracts
                    WHERE workflow_id = ? AND status = 'active'"""
            ).use { stmt ->
                stmt.setObject(1, workflowId)
                stmt.executeQuery().use { rs ->
                    val m = mutableMapOf<String, Triple<Boolean, Boolean, String?>>()
                    while (rs.next()) {
                        m[rs.getString("node_id")] =
                            Triple(rs.getBoolean("has_schema"), rs.getBoolean("decoding_enforced"),
                                   rs.getString("decoding_note"))
                    }
                    m
                }
            }
        }

        val report = ContractLinter.readiness(graph, contracts)
        return Response.ok(report)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun activeContract(workflowId: UUID, workspaceId: UUID, nodeId: String): Pair<Int, String>? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT version, content_hash FROM node_contracts
                    WHERE workflow_id = ? AND workspace_id = ? AND node_id = ? AND status = 'active'"""
            ).use { stmt ->
                stmt.setObject(1, workflowId); stmt.setObject(2, workspaceId); stmt.setString(3, nodeId)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) rs.getInt(1) to rs.getString(2) else null
                }
            }
        }

    /**
     * Canonical form for hashing.
     *
     * Keys sorted, so `{a, b}` and `{b, a}` hash identically — two authorings of the
     * same contract ARE the same contract, and branching the baseline because a JSON
     * serialiser reordered a map would make the hash useless.
     */
    private fun canonicalise(body: ContractBody): String = toJson(mapOf(
        "schema" to sortKeys(body.schema),
        "assertions" to body.assertions.map { sortKeys(it) },
        "groundedness" to body.groundedness,
        "confidence" to sortKeys(body.confidence),
    ))

    @Suppress("UNCHECKED_CAST")
    private fun sortKeys(v: Any?): Any? = when (v) {
        is Map<*, *> -> (v as Map<String, Any?>).toSortedMap().mapValues { sortKeys(it.value) }
        is List<*> -> v.map { sortKeys(it) }
        else -> v
    }

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
            .joinToString("") { "%02x".format(it) }

    private fun rowToMap(rs: java.sql.ResultSet) = mapOf(
        "nodeId" to rs.getString("node_id"),
        "version" to rs.getInt("version"),
        "contentHash" to rs.getString("content_hash"),
        "schema" to rs.getString(4)?.let { com.vectorbea.api.http.fromJson<Map<String, Any?>>(it) },
        "assertions" to (rs.getString(5)?.let { com.vectorbea.api.http.fromJson<List<Any?>>(it) } ?: emptyList<Any?>()),
        "groundedness" to rs.getString("groundedness"),
        "status" to rs.getString("status"),
        "source" to rs.getString("source"),
        "decodingEnforced" to rs.getBoolean("decoding_enforced"),
        "decodingNote" to rs.getString("decoding_note"),
        "createdAt" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
    )
}
