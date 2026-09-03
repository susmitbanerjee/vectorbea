package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

/**
 * What a tool gives back to a model.
 *
 * ── THE PROBLEM THIS EXISTS FOR, MEASURED ───────────────────────────────────
 * An observation today is the tool's whole result — `{statusCode, body, headers}`
 * — serialised and cut at `MAX_TOOL_PAYLOAD_CHARS` with `String.take`. Against
 * representative API responses (`ObservationSizeReport`), six of eight truncate,
 * and **every truncated one is unparseable JSON**: the cut lands mid-structure,
 * so the model does not receive less information, it receives a syntax error and
 * has to guess what was there. A 56-field CRM contact does not fit in the budget
 * on its own. The ten fields an agent wants are 17% of that record. Response
 * headers, which no model has ever read, are 18% of the budget.
 *
 * ── THE FIX IS ORDERING, NOT A BIGGER CAP ───────────────────────────────────
 * Raising the cap buys a linear amount of the same noise and costs it on every
 * observation of every iteration. Projecting first changes the shape of the
 * problem: ten meaningful fields per record instead of fifty-six, so the cap
 * stops being the thing that decides what the model knows.
 *
 * **Projection happens before the cap, and the full result still goes to the
 * payload store.** Those are two different consumers with two different needs —
 * the model needs the few fields that matter, the debugger needs everything —
 * and conflating them is what made the cap destructive.
 *
 * ── A TOOL WITHOUT A CONTRACT IS UNCHANGED ──────────────────────────────────
 * `null` is not a degraded contract, it is no contract: the tool behaves exactly
 * as it did, whole result and all. Contracts are adopted per tool, and nothing
 * breaks on the deploy that ships this.
 */
data class ToolResultContract(
    /** Bumped when the SHAPE changes, so a stored contract can be read forward. */
    val version: Int = 1,
    /** The fields the model sees. Empty means "project nothing", not "project all". */
    val fields: List<Field> = emptyList(),
    /** Present when the result is a collection. See [Collection]. */
    val collection: Collection? = null,
    /** Provider errors, mapped to something an agent can act on. */
    val errors: List<ErrorRule> = emptyList(),
    /** When to reach for this tool rather than another. Goes in the prompt. */
    val usage: String? = null,
) {
    /**
     * One projected field.
     *
     * [path] is dotted, rooted at the tool's whole result — so `body.Id`, not
     * `Id`. Rooting at the result rather than at `body` is deliberate: a DB tool
     * has no `body`, and a contract that assumed one would silently project
     * nothing for half the tool types.
     *
     * [desc] is the one line the brief asks for. It is not decoration: an agent
     * shown `"ownerId"` and an agent shown `"ownerId — the user who owns the
     * renewal"` choose differently, and the second does not need an extra
     * iteration to find out.
     */
    data class Field(val path: String, val `as`: String? = null, val desc: String? = null) {
        /** The name the model sees. The last path segment unless renamed. */
        val name: String get() = `as` ?: path.substringAfterLast('.')
    }

    /**
     * How to summarise a list.
     *
     * ── WHY A COUNT AND A SAMPLE BEAT A TRUNCATED ARRAY ─────────────────────
     * A model handed a cut-off array has no way to know it was cut. It reasons
     * as though it has seen everything, concludes there are five matches when
     * there are forty-seven, and answers confidently and wrongly. Telling it
     * "47 results, showing 5" costs about twenty tokens and removes that entire
     * class of error — and it lets the model decide to narrow its query, which
     * is the behaviour we actually want.
     */
    data class Collection(
        /** Dotted path to the array. */
        val path: String,
        /**
         * Where the true total lives, when the API reports one.
         *
         * Null means the array's own length is all we know — and the summary then
         * says so, rather than claiming a total it inferred from a page.
         */
        val totalPath: String? = null,
        /** How many elements to project. */
        val sample: Int = 5,
        /** How to get the rest, in the tool's own terms. */
        val moreHint: String? = null,
    )

    /**
     * One provider error, mapped to a stable shape.
     *
     * ── WHY THIS REDUCES ITERATIONS DIRECTLY ────────────────────────────────
     * An agent that receives `HTTP 403` has learned nothing it can act on, so it
     * does the only thing available: it tries again, usually with a slightly
     * different input, until it runs out of iterations. Every one of those is a
     * model call, a provider request and a share of the rate limit.
     *
     * An agent that receives "auth failed, retrying will not help, the credential
     * needs reconnecting" stops. `retryable` is the field that does the work, and
     * it is why this is a contract rather than a message template.
     */
    data class ErrorRule(
        /** HTTP status this rule matches. Null matches any status. */
        val status: Int? = null,
        /** Substring of the provider's error body. Null matches anything. */
        val bodyContains: String? = null,
        /** `auth` | `not_found` | `invalid_input` | `rate_limit` | `server` | `unknown`. */
        val kind: String = "unknown",
        /** Whether trying the same thing again could plausibly work. */
        val retryable: Boolean = false,
        /** What would actually fix it, in the operator's terms. */
        val fix: String? = null,
    ) {
        fun matches(status: Int?, body: String?): Boolean {
            if (this.status != null && this.status != status) return false
            if (bodyContains != null && body?.contains(bodyContains, ignoreCase = true) != true) return false
            return true
        }
    }

    companion object {
        private val mapper = ObjectMapper()

        /**
         * Parse a stored contract. Null on anything unreadable.
         *
         * Never throws. A malformed contract must degrade to the pre-contract
         * behaviour rather than failing the tool call: the contract is an
         * improvement to an observation, and an improvement that can break the
         * thing it improves is not one. The caller logs; this returns null.
         */
        fun parse(json: String?): ToolResultContract? {
            if (json.isNullOrBlank() || json == "{}" || json == "null") return null
            return try {
                val n = mapper.readTree(json)
                val fields = n["fields"]?.mapNotNull { f ->
                    val p = f["path"]?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                    Field(p, f["as"]?.asText(), f["desc"]?.asText())
                } ?: emptyList()
                val coll = n["collection"]?.let { c ->
                    val p = c["path"]?.asText()?.takeIf { it.isNotBlank() } ?: return@let null
                    Collection(
                        path = p,
                        totalPath = c["totalPath"]?.asText()?.takeIf { it.isNotBlank() },
                        /* Bounded: a contract asking for a thousand samples would
                           reintroduce exactly the problem it exists to solve. */
                        sample = (c["sample"]?.asInt() ?: 5).coerceIn(1, 25),
                        moreHint = c["moreHint"]?.asText()?.takeIf { it.isNotBlank() },
                    )
                }
                val errors = n["errors"]?.mapNotNull { e ->
                    ErrorRule(
                        status = e["status"]?.takeIf { it.isInt }?.asInt(),
                        bodyContains = e["bodyContains"]?.asText()?.takeIf { it.isNotBlank() },
                        kind = e["kind"]?.asText()?.takeIf { it.isNotBlank() } ?: "unknown",
                        retryable = e["retryable"]?.asBoolean() ?: false,
                        fix = e["fix"]?.asText()?.takeIf { it.isNotBlank() },
                    )
                } ?: emptyList()
                val contract = ToolResultContract(
                    version = n["version"]?.asInt() ?: 1,
                    fields = fields,
                    collection = coll,
                    errors = errors,
                    usage = n["usage"]?.asText()?.takeIf { it.isNotBlank() },
                )
                /* A contract that declares nothing is not a contract. Returning it
                   would project every result to `{}` — an empty observation that
                   reads exactly like a tool returning no data. */
                if (contract.fields.isEmpty() && contract.collection == null &&
                    contract.errors.isEmpty() && contract.usage == null) null else contract
            } catch (_: Exception) {
                null
            }
        }

        /**
         * Walk a dotted path. Null when any segment is missing.
         *
         * Arrays are addressed only as whole nodes — there is deliberately no
         * `records[0].name` syntax. Indexing into a result is a query, and a
         * contract that could express one would become a second, worse expression
         * language beside the one the workflow already has.
         */
        fun at(root: JsonNode?, path: String): JsonNode? {
            var cur = root ?: return null
            for (seg in path.split('.')) {
                if (seg.isEmpty()) continue
                cur = cur.get(seg) ?: return null
            }
            return cur.takeUnless { it.isNull }
        }
    }
}
