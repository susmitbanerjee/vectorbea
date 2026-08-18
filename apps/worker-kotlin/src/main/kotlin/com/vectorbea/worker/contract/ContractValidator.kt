package com.vectorbea.worker.contract

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Runs a node's output contract — schema then assertions — and decides whether the
 * output may be committed.
 *
 * WHERE THIS IS CALLED IS THE POINT
 * ---------------------------------
 * §3 of the reliability doc lists context poisoning as failure mode #6: a bad
 * upstream output compounds downstream. Its defence is not a cleverer check, it is
 * **where** the check runs:
 *
 * > Validate before commit, and a bad output never becomes durable. Validate
 * > after, and you've made it permanent. This is a one-line architectural
 * > decision with enormous consequences.
 *
 * So this is invoked from `WorkflowRuntime` between the executor returning and
 * `ctx.setOutput` / `stepOutputView.put` / the checkpoint. A `fail` verdict
 * converts the node result to a failure and nothing is written. There is no path
 * where a failing output reaches `step_outputs`, and the test in
 * `scripts/load/contract-containment.mjs` asserts exactly that.
 *
 * WHY SCHEMA VALIDATION AT ALL WHEN LAYER 0 EXISTS
 * ------------------------------------------------
 * Constrained decoding makes schema violation impossible *where the provider
 * enforces it*. Not every provider path can, older runs predate it, and a node may
 * declare a schema while its model does not support structured output — which is a
 * publish-time error but must still fail closed at runtime if it somehow occurs.
 * Belt and braces, cheap enough not to argue about.
 */
class ContractValidator(
    private val dataSource: DataSource,
    private val assertions: AssertionEngine = AssertionEngine(),
) {
    private val log = logger()
    private val mapper = ObjectMapper()

    /** What the contract decided. */
    enum class Outcome {
        /** Commit normally. */
        PASS,
        /** Do NOT commit. The node fails with the specific assertion message. */
        FAIL,
        /** Commit, mark the run low-confidence, surface on Control. */
        WARN,
        /** Commit, but force a human approval gate before any downstream side effect. */
        GATE,
    }

    data class Verdict(
        val outcome: Outcome,
        val schemaValid: Boolean,
        val schemaErrors: List<String>,
        val results: List<AssertionEngine.Result>,
        val durationMs: Long,
        val contractId: UUID? = null,
        val contractVersion: Int? = null,
        val contractHash: String? = null,
    ) {
        val committable: Boolean get() = outcome != Outcome.FAIL

        /**
         * The message the user sees when the node fails.
         *
         * Names the assertion and the observed value — "risk_score was 340,
         * expected 0-100" — rather than "validation error". §5 of the prompt is
         * explicit that the generic version is not acceptable, and it is right:
         * "validation error" sends the user to us, the specific version sends them
         * to their prompt.
         */
        fun failureMessage(): String {
            if (!schemaValid) {
                return "Output did not match the declared schema: " +
                    schemaErrors.take(3).joinToString("; ") +
                    if (schemaErrors.size > 3) " (and ${schemaErrors.size - 3} more)" else ""
            }
            val failed = results.filter { !it.passed && it.severity == AssertionEngine.Severity.FAIL }
            return failed.joinToString(" ") { it.message }
                .ifBlank { "Output failed its contract." }
        }
    }

    data class Contract(
        val id: UUID,
        val version: Int,
        val hash: String,
        val schema: Map<String, Any?>?,
        val assertions: List<AssertionEngine.Assertion>,
        /** required | optional | none - drives Layer 2 for this node. */
        val groundedness: String = "none",
    )

    /**
     * The active contract for a node, or null.
     *
     * Only `status = 'active'`. A draft — inferred from history and awaiting
     * confirmation — is invisible here on purpose: applying an unconfirmed
     * hypothesis as an enforcement rule would fail runs for violating a contract
     * nobody wrote.
     */
    fun contractFor(workflowId: UUID, nodeId: String): Contract? = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, version, content_hash, schema_json::text, assertions_json::text,
                          groundedness
                     FROM node_contracts
                    WHERE workflow_id = ? AND node_id = ? AND status = 'active'"""
            ).use { stmt ->
                stmt.setObject(1, workflowId)
                stmt.setString(2, nodeId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) null else Contract(
                        id = UUID.fromString(rs.getString("id")),
                        version = rs.getInt("version"),
                        hash = rs.getString("content_hash"),
                        schema = rs.getString(4)?.let { parseObject(it) },
                        assertions = parseAssertions(rs.getString(5)),
                        groundedness = rs.getString("groundedness") ?: "none",
                    )
                }
            }
        }
    }.getOrElse {
        // A contract we cannot read must not silently become "no contract" — that
        // would turn a database blip into an unenforced rule. Logged at ERROR; the
        // caller treats null as "no contract", so this IS a fail-open, which is
        // recorded as D26 rather than hidden.
        log.error("[contract] could not load the contract for {}/{}: {}", workflowId, nodeId, it.message)
        null
    }

    /**
     * Validate an output against a contract.
     *
     * @param stats historical statistics for this node, so `stats.p50` and
     *        `stats.stddev` resolve in expressions.
     */
    fun validate(
        contract: Contract,
        input: Any?,
        output: Any?,
        stats: Map<String, Any?> = emptyMap(),
        context: Map<String, Any?> = emptyMap(),
    ): Verdict {
        val startedAt = System.currentTimeMillis()

        // ── Schema ────────────────────────────────────────────────────────
        val schemaErrors = contract.schema?.let { JsonSchemaValidator.validate(output, it) } ?: emptyList()
        val schemaValid = schemaErrors.isEmpty()

        // A schema violation short-circuits: assertions written against
        // `output.risk_score` are meaningless when the output has no such field,
        // and reporting ten consequential failures buries the one real cause.
        if (!schemaValid) {
            return Verdict(
                outcome = Outcome.FAIL,
                schemaValid = false,
                schemaErrors = schemaErrors,
                results = emptyList(),
                durationMs = System.currentTimeMillis() - startedAt,
                contractId = contract.id,
                contractVersion = contract.version,
                contractHash = contract.hash,
            )
        }

        // ── Assertions ────────────────────────────────────────────────────
        val results = assertions.evaluateAll(
            contract.assertions,
            AssertionEngine.Context(input = input, output = output, stats = stats, context = context),
        )

        // Strongest severity among the failures wins. FAIL > GATE > WARN: a run
        // that both warns and fails is a failure, and quietly committing it
        // because a warn was evaluated later would be the worst possible ordering
        // bug in this file.
        val failed = results.filter { !it.passed }
        val outcome = when {
            failed.any { it.severity == AssertionEngine.Severity.FAIL } -> Outcome.FAIL
            failed.any { it.severity == AssertionEngine.Severity.GATE } -> Outcome.GATE
            failed.any { it.severity == AssertionEngine.Severity.WARN } -> Outcome.WARN
            else -> Outcome.PASS
        }

        return Verdict(
            outcome = outcome,
            schemaValid = true,
            schemaErrors = emptyList(),
            results = results,
            durationMs = System.currentTimeMillis() - startedAt,
            contractId = contract.id,
            contractVersion = contract.version,
            contractHash = contract.hash,
        )
    }

    /**
     * Historical statistics for a node, so `stats.p50_risk_score` resolves.
     *
     * Computed from previous successful outputs of the SAME node. Numeric top-level
     * fields only: `stats.p50_nested.deep.field` is not expressible and pretending
     * otherwise would give an assertion author a value that is silently always null.
     *
     * Returns empty on any failure — an assertion referencing stats then compares
     * against null, which is false, which fails the assertion. That is the right
     * direction: a rule that cannot be checked should not pass.
     */
    fun statsFor(workflowId: UUID, nodeId: String, sampleSize: Int = 100): Map<String, Any?> = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(STATS_SQL).use { stmt ->
                stmt.setObject(1, workflowId)
                stmt.setString(2, nodeId)
                stmt.setInt(3, sampleSize)
                stmt.executeQuery().use { rs ->
                    val out = mutableMapOf<String, Any?>()
                    while (rs.next()) {
                        val key = rs.getString("field")
                        out["p50_$key"] = rs.getDouble("p50")
                        out["avg_$key"] = rs.getDouble("avg")
                        out["min_$key"] = rs.getDouble("min")
                        out["max_$key"] = rs.getDouble("max")
                        out["stddev_$key"] = rs.getDouble("stddev")
                    }
                    // Bare aliases too, so a single-metric node can write
                    // `stats.p50` rather than `stats.p50_risk_score`.
                    if (out.keys.count { it.startsWith("p50_") } == 1) {
                        out["p50"] = out.entries.first { it.key.startsWith("p50_") }.value
                        out["stddev"] = out.entries.first { it.key.startsWith("stddev_") }.value
                    }
                    out
                }
            }
        }
    }.getOrElse {
        log.debug("[contract] no stats for {}/{}: {}", workflowId, nodeId, it.message)
        emptyMap()
    }

    /** Record what the contract decided, for the reliability baseline. */
    fun recordValidation(
        runId: UUID,
        workspaceId: UUID,
        nodeId: String,
        verdict: Verdict,
    ) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO contract_validations
                        (run_id, workspace_id, node_id, contract_id, contract_version,
                         contract_hash, outcome, schema_valid, schema_errors_json,
                         assertion_results_json, duration_ms)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)"""
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.setObject(2, workspaceId)
                    stmt.setString(3, nodeId)
                    stmt.setObject(4, verdict.contractId)
                    if (verdict.contractVersion != null) stmt.setInt(5, verdict.contractVersion)
                    else stmt.setNull(5, java.sql.Types.INTEGER)
                    stmt.setString(6, verdict.contractHash)
                    stmt.setString(7, verdict.outcome.name.lowercase())
                    stmt.setBoolean(8, verdict.schemaValid)
                    stmt.setString(9, mapper.writeValueAsString(verdict.schemaErrors))
                    stmt.setString(10, mapper.writeValueAsString(verdict.results.map {
                        mapOf("name" to it.name, "severity" to it.severity.name.lowercase(),
                              "passed" to it.passed, "message" to it.message, "actual" to it.actual)
                    }))
                    stmt.setLong(11, verdict.durationMs)
                    stmt.executeUpdate()
                }
            }
        }.onFailure {
            log.warn("[contract] could not record the validation for run {} node {}: {}",
                runId, nodeId, it.message)
        }
    }

    /** Mark the run low-confidence — the `warn` surface. */
    fun markLowConfidence(runId: UUID, notes: List<String>) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE agent_runs
                          SET low_confidence = true,
                              confidence_notes_json =
                                  COALESCE(confidence_notes_json, '[]'::jsonb) || ?::jsonb,
                              updated_at = now()
                        WHERE id = ?"""
                ).use { stmt ->
                    stmt.setString(1, mapper.writeValueAsString(notes))
                    stmt.setObject(2, runId)
                    stmt.executeUpdate()
                }
            }
        }.onFailure {
            log.warn("[contract] could not flag run {} as low-confidence: {}", runId, it.message)
        }
    }

    // ── Parsing ─────────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun parseObject(json: String): Map<String, Any?>? =
        runCatching { mapper.readValue(json, Map::class.java) as Map<String, Any?> }.getOrNull()

    @Suppress("UNCHECKED_CAST")
    private fun parseAssertions(json: String?): List<AssertionEngine.Assertion> {
        if (json.isNullOrBlank()) return emptyList()
        return runCatching {
            (mapper.readValue(json, List::class.java) as List<Map<String, Any?>>).mapNotNull { m ->
                val name = m["name"] as? String ?: return@mapNotNull null
                val expr = m["expr"] as? String ?: return@mapNotNull null
                AssertionEngine.Assertion(
                    name = name,
                    expr = expr,
                    // Unknown severity reads as FAIL, the strictest. A typo in a
                    // severity should not silently downgrade a rule to advisory.
                    severity = when ((m["severity"] as? String)?.lowercase()) {
                        "warn" -> AssertionEngine.Severity.WARN
                        "gate" -> AssertionEngine.Severity.GATE
                        else -> AssertionEngine.Severity.FAIL
                    },
                    message = m["message"] as? String,
                )
            }
        }.getOrElse {
            log.warn("[contract] could not parse assertions: {}", it.message)
            emptyList()
        }
    }

    private companion object {
        /**
         * Per-field numeric statistics over a node's recent successful outputs.
         *
         * `jsonb_each` explodes the output object; the numeric filter keeps only
         * fields a percentile makes sense for. Text-cast then double-cast because
         * jsonb numerics do not implicitly coerce.
         */
        val STATS_SQL = """
            WITH samples AS (
                SELECT so.raw_output_json_sanitized AS out
                  FROM step_outputs so
                  JOIN agent_runs r ON r.id = so.run_id
                 WHERE r.workflow_id = ? AND so.node_id = ? AND r.status = 'succeeded'
                   AND jsonb_typeof(so.raw_output_json_sanitized) = 'object'
                 ORDER BY so.created_at DESC
                 LIMIT ?
            ),
            fields AS (
                SELECT e.key AS field, (e.value #>> '{}')::double precision AS val
                  FROM samples s, LATERAL jsonb_each(s.out) AS e(key, value)
                 WHERE jsonb_typeof(e.value) = 'number'
            )
            SELECT field,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY val) AS p50,
                   avg(val) AS avg, min(val) AS min, max(val) AS max,
                   COALESCE(stddev_pop(val), 0) AS stddev
              FROM fields
             GROUP BY field
        """.trimIndent()
    }
}
