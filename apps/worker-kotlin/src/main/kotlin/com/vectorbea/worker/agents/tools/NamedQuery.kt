package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.ObjectMapper

/**
 * SQL an agent may run: authored by a human, stored with the tool, chosen by id.
 *
 * ── THE SAME MOVE AS THE TOOL GRANT LIST ────────────────────────────────────
 * The model chooses from a validated set and the runtime executes. It is the
 * runtime invariant this codebase already lives by — "the model chooses; the
 * runtime executes; no action is dispatched without validation against a grant
 * list" — applied one level down, to the statement rather than the tool.
 *
 * What that replaces is a keyword match deciding whether a statement is a read or
 * a write, on a path that reaches a production database. [access] is DECLARED.
 * Nothing in this file or below it inspects the SQL to classify it, and that is
 * the point: a classifier can be defeated by a CTE, a comment, or a `SELECT
 * writes_something()`, and every fix to a classifier is a guess about what the
 * next input looks like.
 *
 * ── WHY THE AGENT CANNOT REACH THE SQL ──────────────────────────────────────
 * The agent supplies a query id and parameters. It never sees, composes or
 * modifies the statement. A query id that is not in the catalogue is not a bad
 * query — it is not a query at all, and the executor refuses before it opens a
 * connection.
 */
data class NamedQuery(
    /** Stable within the tool. What the agent selects. */
    val id: String,
    /** One line: what this answers, in the terms the model is reasoning in. */
    val description: String,
    val parameters: List<Param> = emptyList(),
    /** The statement, with `:name` placeholders. Bound, never interpolated. */
    val sql: String,
    /** DECLARED. Never inferred from [sql]. */
    val access: Access,
    /** Mandatory. Bounded by [MAX_ROWS_CEILING] whatever the declaration says. */
    val maxRows: Int,
    /** Mandatory. Bounded by [MAX_TIMEOUT_MS]. */
    val timeoutMs: Int,
    /** Optional R2 projection for the rows this returns. */
    val resultContract: ToolResultContract? = null,
) {
    enum class Access {
        READ,

        /**
         * A write. Requires approval at the tool boundary, whatever the tool's own
         * `requires_approval` says.
         *
         * The tool flag is about a TOOL; this is about a STATEMENT, and one
         * database tool can legitimately expose a dozen reads and one write. Making
         * the write inherit the tool's flag would mean either gating every read or
         * gating no write.
         */
        WRITE;

        companion object {
            /**
             * Anything not recognisably `read` is a WRITE.
             *
             * The asymmetry is the whole safety property: an unreadable declaration
             * must fail towards the gate. A misspelled `"raed"` that defaulted to
             * READ would be a write executing unapproved, silently, forever.
             */
            fun parse(s: String?): Access =
                if (s?.trim()?.lowercase() == "read") READ else WRITE
        }
    }

    data class Param(
        val name: String,
        /** `string` | `number` | `boolean` | `date`. Checked before binding. */
        val type: String = "string",
        val required: Boolean = true,
        val description: String? = null,
    )

    /**
     * The statement rewritten for JDBC, and the order to bind in.
     *
     * `:name` becomes `?`, and [order] lists the parameter name for each `?` in
     * the order the driver expects. A name used twice appears twice — which is why
     * this is a list rather than a map, and why the rewrite happens here rather
     * than at the call site.
     */
    data class Bound(val sql: String, val order: List<String>)

    /**
     * Rewrite `:name` placeholders to `?`.
     *
     * Placeholders inside string literals are left alone: `WHERE note = ':not a
     * param'` is a literal colon, and rewriting it would corrupt the statement and
     * shift every subsequent binding by one. Tracked by scanning quotes rather
     * than by a regex, because a regex cannot see that it is inside a string.
     */
    fun bind(): Bound {
        val out = StringBuilder(sql.length)
        val order = mutableListOf<String>()
        var i = 0
        var inSingle = false
        var inDouble = false
        while (i < sql.length) {
            val c = sql[i]
            when {
                c == '\'' && !inDouble -> { inSingle = !inSingle; out.append(c); i++ }
                c == '"' && !inSingle -> { inDouble = !inDouble; out.append(c); i++ }
                /* `::` is a Postgres cast, not a placeholder. Copied whole so
                   `id::text` survives — missing this turns a cast into a parameter
                   named `text` and the statement stops making sense. */
                c == ':' && !inSingle && !inDouble && i + 1 < sql.length && sql[i + 1] == ':' -> {
                    out.append("::"); i += 2
                }
                c == ':' && !inSingle && !inDouble -> {
                    var j = i + 1
                    while (j < sql.length && (sql[j].isLetterOrDigit() || sql[j] == '_')) j++
                    val name = sql.substring(i + 1, j)
                    if (name.isEmpty()) { out.append(c); i++ }
                    else { out.append('?'); order += name; i = j }
                }
                else -> { out.append(c); i++ }
            }
        }
        return Bound(out.toString(), order)
    }

    /**
     * The parameter schema the model is shown, in the same shape as any tool's.
     *
     * Discovery of a named query is therefore identical to discovery of a tool —
     * one mechanism, not two.
     */
    fun inputSchema(): Map<String, Any?> = mapOf(
        "type" to "object",
        "properties" to parameters.associate { p ->
            p.name to buildMap<String, Any?> {
                put("type", when (p.type.lowercase()) {
                    "number", "integer" -> "number"
                    "boolean" -> "boolean"
                    else -> "string"
                })
                p.description?.let { put("description", it) }
            }
        },
        "required" to parameters.filter { it.required }.map { it.name },
    )

    /**
     * Check and coerce the caller's arguments. Returns the values to bind, in
     * [Bound.order], or a message naming what is wrong.
     *
     * Coercion is deliberate and narrow: an agent supplies JSON, so a number
     * arrives as a `Double` where the column wants an `Int`, and refusing that
     * would spend an iteration on a difference the agent cannot see. What is NOT
     * coerced is a type the parameter did not declare — a string where a number is
     * required is an error, because binding it would either fail at the driver or
     * silently match nothing.
     */
    fun bindValues(args: Map<String, Any?>, order: List<String>): Result<List<Any?>> {
        val byName = parameters.associateBy { it.name }
        for (p in parameters) {
            if (p.required && args[p.name] == null) {
                return Result.failure(IllegalArgumentException(
                    "query '$id' requires the parameter '${p.name}'" +
                    (p.description?.let { " ($it)" } ?: "")))
            }
        }
        for (name in order) {
            if (name !in byName) {
                /* The SQL names a placeholder the catalogue does not declare. A
                   tool-author error, and one that must not reach the driver: the
                   binding would be off by one and the statement would run with the
                   wrong values in the wrong columns. */
                return Result.failure(IllegalStateException(
                    "query '$id' binds ':$name' but declares no such parameter"))
            }
        }
        val values = mutableListOf<Any?>()
        for (name in order) {
            val p = byName.getValue(name)
            val raw = args[name]
            if (raw == null) { values += null; continue }
            val coerced = when (p.type.lowercase()) {
                "number", "integer" -> (raw as? Number)
                    ?: (raw as? String)?.toDoubleOrNull()
                    ?: return Result.failure(IllegalArgumentException(
                        "parameter '${p.name}' of query '$id' must be a number, got '$raw'"))
                "boolean" -> (raw as? Boolean)
                    ?: (raw as? String)?.toBooleanStrictOrNull()
                    ?: return Result.failure(IllegalArgumentException(
                        "parameter '${p.name}' of query '$id' must be true or false, got '$raw'"))
                else -> raw.toString()
            }
            values += coerced
        }
        return Result.success(values)
    }

    companion object {
        private val mapper = ObjectMapper()

        /**
         * Ceilings the declaration cannot exceed.
         *
         * A catalogue is written by a human and reviewed once; these are what stop
         * a typo in it from becoming a worker heap exhaustion. `maxRows` is
         * deliberately far below `DbReadNodeExecutor.HARD_MAX_ROWS` (10 000),
         * because that bound is a ROW count and the thing that actually breaks is
         * bytes — ten thousand wide rows is tens of megabytes materialised into a
         * `List<Map>` before anything measures it.
         */
        const val MAX_ROWS_CEILING = 500
        const val DEFAULT_MAX_ROWS = 50
        const val MAX_TIMEOUT_MS = 30_000
        const val DEFAULT_TIMEOUT_MS = 5_000

        /**
         * The separator between a tool id and a query id in a synthetic tool id.
         *
         * Each named query is exposed to the model as its own tool, so the id it
         * chooses has to carry both. `#` because a UUID cannot contain one, which
         * makes the split unambiguous in both directions.
         */
        const val QUERY_ID_SEPARATOR = '#'

        fun syntheticToolId(toolId: String, queryId: String) =
            "$toolId$QUERY_ID_SEPARATOR$queryId"

        /** Split a synthetic id back. Null query id for a plain tool id. */
        fun splitToolId(id: String): Pair<String, String?> {
            val i = id.indexOf(QUERY_ID_SEPARATOR)
            return if (i < 0) id to null else id.substring(0, i) to id.substring(i + 1)
        }

        /**
         * Parse a tool's catalogue. Empty on anything unreadable.
         *
         * A malformed catalogue yields NO queries rather than a partial one, and
         * the tool then has nothing an agent can call. That is the safe direction:
         * the alternative is running the half of a catalogue that happened to
         * parse, which is a set nobody reviewed.
         */
        fun parseCatalogue(json: String?): List<NamedQuery> {
            if (json.isNullOrBlank() || json == "{}" || json == "null") return emptyList()
            return try {
                val root = mapper.readTree(json)
                val arr = root["queries"] ?: return emptyList()
                arr.mapNotNull { q ->
                    val id = q["id"]?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    val sql = q["sql"]?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    /* A query the runtime cannot bound is not a query it will run.
                       Both limits are mandatory in the contract and defaulted here
                       rather than refused, because a catalogue that silently drops
                       an entry is worse than one that runs it conservatively. */
                    NamedQuery(
                        id = id,
                        description = q["description"]?.asText() ?: id,
                        parameters = q["parameters"]?.mapNotNull { p ->
                            val n = p["name"]?.asText()?.takeIf { it.isNotBlank() }
                                ?: return@mapNotNull null
                            Param(
                                name = n,
                                type = p["type"]?.asText() ?: "string",
                                required = p["required"]?.asBoolean() ?: true,
                                description = p["description"]?.asText()?.takeIf { it.isNotBlank() },
                            )
                        } ?: emptyList(),
                        sql = sql,
                        access = Access.parse(q["access"]?.asText()),
                        maxRows = (q["maxRows"]?.asInt() ?: DEFAULT_MAX_ROWS)
                            .coerceIn(1, MAX_ROWS_CEILING),
                        timeoutMs = (q["timeoutMs"]?.asInt() ?: DEFAULT_TIMEOUT_MS)
                            .coerceIn(100, MAX_TIMEOUT_MS),
                        resultContract = q["resultContract"]?.let {
                            ToolResultContract.parse(mapper.writeValueAsString(it))
                        },
                    )
                }
            } catch (_: Exception) {
                emptyList()
            }
        }
    }
}
