package com.vectorbea.worker.agents.brain.runtime

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.MapperFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.json.JsonMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.fasterxml.jackson.module.kotlin.KotlinFeature
import com.fasterxml.jackson.module.kotlin.KotlinModule
import com.vectorbea.worker.agents.brain.model.AgentAction

/**
 * Reading the action a model returned, forgiving the shapes models actually send.
 *
 * Each of these used to fail the parse; the runtime then substituted a repair THINK,
 * and the agent spent an iteration — and its share of the token budget — producing
 * the same answer again:
 *
 *   · `"toolInput": null` / `"finalOutput": null` on a FINAL, because the format in
 *     the prompt lists every field. A null for a field with a default is the default.
 *   · no `type`, when the rest of the object says what it is: a `toolId` is a tool
 *     call, a `finalOutput` is a final answer, a `failReason` is a failure.
 *   · the action wrapped one level down, `{"action": {...}}`.
 *   · `"type": "final"` in lower case.
 *
 * Nothing here widens what an action may DO. The parsed action goes through
 * `AgentSafetyGuard` exactly as before; this only decides whether it parses.
 */
internal object ActionParsing {

    private val mapper: ObjectMapper = JsonMapper.builder()
        .addModule(KotlinModule.Builder().enable(KotlinFeature.NullIsSameAsDefault).build())
        .enable(MapperFeature.ACCEPT_CASE_INSENSITIVE_ENUMS)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build()

    private val WRAPPERS = listOf("action", "nextAction", "next_action")

    fun parse(json: String): AgentAction {
        var node = mapper.readTree(json)
        if (node is ObjectNode && !node.hasNonNull("type")) {
            WRAPPERS.firstNotNullOfOrNull { key -> node.get(key)?.takeIf { it is ObjectNode && it.hasNonNull("type") } }
                ?.let { node = it }
        }
        val obj = node as? ObjectNode
        if (obj != null && !obj.hasNonNull("type")) {
            val inferred = when {
                obj.hasNonNull("toolId") -> "CALL_TOOL"
                obj.hasNonNull("finalOutput") -> "FINAL"
                obj.hasNonNull("failReason") -> "FAIL"
                else -> null
            }
            if (inferred != null) obj.put("type", inferred)
        }
        return mapper.treeToValue(node, AgentAction::class.java)
    }
}
