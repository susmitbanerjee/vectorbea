package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode

/**
 * Applies a [ToolResultContract] to a tool result, server-side, before the cap.
 *
 * ── WHY SERVER-SIDE AND WHY BEFORE ──────────────────────────────────────────
 * Both halves are load-bearing.
 *
 * SERVER-SIDE, because the alternative is telling the model to ignore fields —
 * and a model asked to ignore forty fields has already paid for them in tokens,
 * in attention, and in the truncation that dropped the one it needed. The
 * projection has to happen where the response is, not where the reasoning is.
 *
 * BEFORE THE CAP, because the cap is a character count and JSON is a tree.
 * Cutting a serialised tree at 2000 characters produces a syntax error — measured
 * at six of eight representative responses, all six unparseable. Projecting first
 * means the thing being capped is already small enough that the cap rarely fires,
 * and when it does it fires on a flat, shallow object where the damage is one
 * missing field rather than a broken document.
 *
 * ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
 * Not a query language. Paths are dotted and cannot index arrays; collections are
 * summarised, not filtered. A projection that could express "the third record
 * where status = active" would be a second expression language beside the one the
 * workflow already has, and the tool author would be writing queries in JSON.
 */
object ResultProjection {

    private val mapper = ObjectMapper()

    /**
     * The projected observation, and what happened to it.
     *
     * [applied] is false when there was no contract or nothing matched, which is
     * the signal recorded on the iteration — distinct from "a contract ran and
     * produced an empty object", which is a contract that needs fixing and looks
     * identical from the outside.
     */
    data class Projected(
        val json: String,
        val applied: Boolean,
        /** Fields the contract asked for that the response did not contain. */
        val missing: List<String> = emptyList(),
    )

    /**
     * Project [result] through [contract].
     *
     * Returns the original serialisation when there is no contract, so the caller
     * has one path rather than a branch at every call site.
     */
    fun project(result: Map<String, Any?>, contract: ToolResultContract?): Projected {
        val whole = runCatching { mapper.writeValueAsString(result) }
            .getOrDefault(result.toString())
        if (contract == null) return Projected(whole, applied = false)

        val root = runCatching { mapper.readTree(whole) }.getOrNull()
            ?: return Projected(whole, applied = false)

        val out = mapper.createObjectNode()
        val missing = mutableListOf<String>()

        /* ── THE COLLECTION SUMMARY ──────────────────────────────────────────
           Deliberately first in the object. Jackson preserves insertion order, so
           if this observation is ever capped anyway, the count and the "showing N
           of M" survive — and those are the two facts whose absence causes a model
           to answer confidently about a list it only half saw. */
        var collectionApplied = false
        contract.collection?.let { c ->
            val arr = ToolResultContract.at(root, c.path) as? ArrayNode
            if (arr == null) {
                /*
                 * ── A SEARCH AND A LOOKUP SHARE ONE CONTRACT ────────────────
                 *
                 * The collection path is absent, which normally means this
                 * response is a SINGLE record rather than a list — the same API
                 * with a `get by id` shape, or a search that matched one thing and
                 * returned it unwrapped. The declared fields describe an element,
                 * and a single record IS an element, so the flat branch below
                 * projects it.
                 *
                 * Found by `ResultContractTest`: without this, a single-record
                 * response fell all the way through to the whole-result fallback
                 * and was completely unimproved — 696 tokens before and after,
                 * still truncated. A tool author would have had to write two
                 * contracts for one API, and the failure was silent.
                 */
                missing += c.path
            } else {
                collectionApplied = true
                val declaredTotal = c.totalPath
                    ?.let { ToolResultContract.at(root, it) }
                    ?.takeIf { it.isNumber }?.asInt()
                val shown = minOf(c.sample, arr.size())

                out.put("count", declaredTotal ?: arr.size())
                out.put("showing", shown)
                /*
                 * Say when the total is only what this page contained.
                 *
                 * "47 results, showing 5" and "5 results, showing 5" lead to
                 * different actions, and a contract with no `totalPath` cannot
                 * tell them apart. Claiming the smaller number would be the
                 * confident-and-wrong failure this summary exists to prevent, so
                 * the uncertainty is stated instead.
                 */
                if (declaredTotal == null) {
                    out.put("countIs", "this page only — the API did not report a total")
                }
                if ((declaredTotal ?: arr.size()) > shown) {
                    out.put("more", true)
                    c.moreHint?.let { out.put("howToGetMore", it) }
                }

                val items = mapper.createArrayNode()
                for (i in 0 until shown) {
                    items.add(projectOne(arr.get(i), contract.fields, missing, rootRelative = true))
                }
                out.set<JsonNode>("items", items)
            }
        }

        /* ── THE FLAT FIELDS ─────────────────────────────────────────────────
           Skipped only when a collection was actually projected: the fields
           describe an ELEMENT and have already been applied to each item, and
           applying them to the root as well would project the envelope's keys and
           leave a pile of nulls beside the items. When no collection was found the
           response is a single record, and these are the fields for it. */
        if (!collectionApplied) {
            val one = projectOne(root, contract.fields, missing, rootRelative = false)
            one.fields().forEach { (k, v) -> out.set<JsonNode>(k, v) }
        }

        /*
         * A contract that projected nothing at all is a contract that does not
         * match this response — an API version changed, a field was renamed. The
         * whole result is better than an empty object, which reads to the model as
         * "the tool found nothing" and is the worst possible failure mode: silent,
         * confident, and wrong in the direction of doing nothing.
         */
        if (out.isEmpty) return Projected(whole, applied = false, missing = missing)

        return Projected(mapper.writeValueAsString(out), applied = true, missing = missing)
    }

    /**
     * One object, reduced to the contract's fields.
     *
     * [rootRelative] strips the leading segment of each path when projecting a
     * collection ELEMENT: the contract writes `body.records` for the collection
     * and `body.Name` for the field, and inside an element the `body.` prefix is
     * already consumed. Without this the tool author would have to write paths
     * that are relative in one place and absolute in another, which is the sort of
     * rule people get wrong once and then never trust again.
     */
    private fun projectOne(
        node: JsonNode?, fields: List<ToolResultContract.Field>,
        missing: MutableList<String>, rootRelative: Boolean,
    ): ObjectNode {
        val out = mapper.createObjectNode()
        if (node == null) return out
        for (f in fields) {
            val path = if (rootRelative) f.path.substringAfter('.', f.path) else f.path
            val v = ToolResultContract.at(node, path)
                ?: ToolResultContract.at(node, f.path)   // absolute, for a flat element
            if (v == null) { missing += f.path; continue }
            out.set<JsonNode>(f.name, v)
        }
        return out
    }

    /**
     * The field legend for the prompt: `name — one line of meaning`.
     *
     * Sent once with the tool's description rather than repeated in every
     * observation. Repeating it would cost the description's length on every
     * iteration, which is the same mistake as sending forty fields.
     */
    fun legendOf(contract: ToolResultContract?): String? {
        val fields = contract?.fields?.filter { !it.desc.isNullOrBlank() } ?: return null
        if (fields.isEmpty()) return null
        return fields.joinToString("; ") { "${it.name} — ${it.desc}" }
    }
}
