package com.vectorbea.worker.agents.orchestration

import com.vectorbea.observability.keys.CanonicalJson
import com.vectorbea.worker.agents.budget.BudgetVector
import java.time.Instant

/**
 * What one agent asks another to do.
 *
 * ── WHY A STRUCTURE AND NOT A STRING ────────────────────────────────────────
 * A bare prompt passed between agents is the single biggest source of
 * multi-agent failure and the hardest to debug, because nothing records what was
 * actually expected. When the child returns something useless there is no
 * artefact that says whether the child was wrong or the request was: the only
 * evidence is a sentence one model wrote to another, and both parties are gone.
 *
 * Every field here exists so that a failed delegation has a legible cause.
 * [outputSchema] makes "the child returned the wrong shape" a boundary failure
 * with a named mismatch. [successCriteria] and [constraints] record what the
 * caller meant, so a reviewer can tell an under-specified request from a bad
 * worker. [objective] is one imperative sentence because a paragraph is a sign
 * the delegation should have been two.
 */
data class TaskContract(
    /** One sentence, imperative. */
    val objective: String,
    /** Resolved values, small. Not a place for a payload. */
    val inputs: Map<String, Any?> = emptyMap(),
    /**
     * Blackboard POINTERS, never payloads.
     *
     * Handing over a blob means every hop grows the prompt, and prompt growth is
     * how a multi-agent system gets expensive superlinearly: a five-agent chain
     * that passes its context along carries the first agent's inputs into the
     * fifth agent's window, five times over. A pointer costs the same at every
     * depth, and the callee reads only what it needs. See §7.
     */
    val contextRefs: List<ContextRef> = emptyList(),
    /**
     * What the CALLER will validate the result against.
     *
     * Validated by the caller's harness, not the callee's — see
     * [com.vectorbea.worker.agents.orchestration.OutputSchemaCheck]. A child that
     * returns a shape its parent cannot use fails at the boundary with a legible
     * reason, instead of the parent silently reading nulls out of it.
     */
    val outputSchema: Map<String, Any?>? = null,
    /** How the caller will judge the result. Prose, for the model. */
    val successCriteria: String? = null,
    /** "do not contact the customer". Prose, for the model. */
    val constraints: List<String> = emptyList(),
    /** Carved from the parent's remainder by [com.vectorbea.worker.agents.budget.BudgetLedger]. */
    val budget: BudgetVector = BudgetVector.ZERO,
    val deadline: Instant? = null,
) {
    /**
     * The identity of this REQUEST, for the repeated-handoff guard.
     *
     * ── WHAT IS EXCLUDED, AND WHY EACH ONE WOULD BREAK THE GUARD ────────────
     *
     * The guard counts `(from, to, contractHash)` and stops the loop when the
     * same request has already been made too many times. That only works if two
     * genuinely identical requests hash the same. Three fields change on every
     * hop, and including any one of them makes every repeat hash differently —
     * the guard would be present, run on every delegation, and catch nothing:
     *
     *   * **budget** — carved from the parent's REMAINDER, so it shrinks each
     *     time. A→B→A→B would produce four distinct hashes.
     *   * **deadline** — an absolute instant, so it moves with the clock.
     *   * **contextRefs[].watermark** — the blackboard advances as the team
     *     works, so the same pointer resolves to a later version on each hop.
     *     Only the ref's IDENTITY `(key, scope, scopeRef)` is part of the
     *     request; which version it happens to resolve to is not.
     *
     * The model's stated `reason` is not here at all — it lives on the handoff
     * row. §9: hash the contract, not the prose, so a reworded but identical
     * request is still caught.
     *
     * ADDING A FIELD: if it can differ between two hops that mean the same
     * thing, exclude it and add it to this list. If it cannot, include it.
     */
    fun hash(): String = CanonicalJson.hash(
        mapOf(
            "objective" to objective,
            "inputs" to inputs,
            "contextRefs" to contextRefs.map { it.identity() },
            "outputSchema" to outputSchema,
            "successCriteria" to successCriteria,
            "constraints" to constraints,
        )
    )

    /** The wire form stored in `agent_handoffs.contract_json`. */
    fun toMap(): Map<String, Any?> = mapOf(
        "objective" to objective,
        "inputs" to inputs,
        "contextRefs" to contextRefs.map { it.toMap() },
        "outputSchema" to outputSchema,
        "successCriteria" to successCriteria,
        "constraints" to constraints,
        "budget" to budget.toMap(),
        "deadline" to deadline?.toString(),
    )
}

/**
 * A pointer into the blackboard.
 *
 * [watermark] pins which version the callee should read, so a resumed
 * delegation sees what the original one saw rather than whatever the team has
 * written since. It is deliberately NOT part of [TaskContract.hash] — see there.
 */
data class ContextRef(
    val key: String,
    val scope: String = "run",
    val scopeRef: String? = null,
    val watermark: Long? = null,
) {
    /** The part that identifies WHICH value, without saying which version. */
    fun identity(): Map<String, Any?> = mapOf("key" to key, "scope" to scope, "scopeRef" to scopeRef)

    fun toMap(): Map<String, Any?> =
        mapOf("key" to key, "scope" to scope, "scopeRef" to scopeRef, "watermark" to watermark)

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun fromMap(m: Map<String, Any?>): ContextRef? {
            val key = m["key"] as? String ?: return null
            return ContextRef(
                key = key,
                scope = (m["scope"] as? String) ?: "run",
                scopeRef = m["scopeRef"] as? String,
                watermark = (m["watermark"] as? Number)?.toLong(),
            )
        }
    }
}
