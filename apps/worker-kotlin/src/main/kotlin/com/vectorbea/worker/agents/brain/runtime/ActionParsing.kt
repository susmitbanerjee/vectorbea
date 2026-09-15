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
 *   · `"type": "final"` in lower case, or the type under another name as text:
 *     `"action": "FINAL"`, `"actionType": "tool_call"`.
 *   · snake_case field names: `tool_id`, `final_output`, `fail_reason`.
 *   · `finalOutput` as a plain string rather than an object.
 *   · THE ANSWER ITSELF with no envelope. A step that declares output fields tells
 *     the model which fields to return, and a model that has finished sometimes
 *     returns exactly those — `{"summary": …, "verdict": …}` — with no `type`. When
 *     the object carries declared output fields and nothing that belongs to an
 *     action, it is that step's final output.
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
    private val TYPE_ALIASES = listOf("action", "actionType", "action_type", "nextAction", "next_action")
    private val SNAKE_CASE = mapOf(
        "tool_id" to "toolId",
        "tool_input" to "toolInput",
        "final_output" to "finalOutput",
        "fail_reason" to "failReason",
        "reasoning_summary" to "reasoningSummary",
        "target_agent_id" to "targetAgentId",
    )

    /** Fields that belong to the action envelope rather than to an answer. */
    private val ENVELOPE = setOf(
        "type", "toolId", "toolInput", "finalOutput", "failReason", "reasoningSummary",
        "confidence", "targetAgentId",
    ) + TYPE_ALIASES

    /**
     * @param outputFields the step's declared output field names, so a bare answer
     *   carrying them is read as FINAL. Empty disables that one inference.
     */
    fun parse(json: String, outputFields: Set<String> = emptySet()): AgentAction {
        var node = mapper.readTree(json)
        if (node is ObjectNode && !node.hasNonNull("type")) {
            WRAPPERS.firstNotNullOfOrNull { key -> node.get(key)?.takeIf { it is ObjectNode && it.hasNonNull("type") } }
                ?.let { node = it }
        }
        val obj = node as? ObjectNode
        if (obj != null) {
            SNAKE_CASE.forEach { (snake, camel) ->
                if (!obj.has(camel) && obj.has(snake)) obj.set<ObjectNode>(camel, obj.get(snake))
            }
            if (!obj.hasNonNull("type")) {
                TYPE_ALIASES.firstNotNullOfOrNull { key -> obj.get(key)?.takeIf { it.isTextual }?.asText() }
                    ?.let { normalizeType(it) }
                    ?.let { obj.put("type", it) }
            }
            if (!obj.hasNonNull("type")) {
                val inferred = when {
                    obj.hasNonNull("toolId") -> "CALL_TOOL"
                    obj.hasNonNull("finalOutput") -> "FINAL"
                    obj.hasNonNull("failReason") -> "FAIL"
                    isBareAnswer(obj, outputFields) -> {
                        val answer = mapper.createObjectNode()
                        obj.fieldNames().asSequence().filter { it !in ENVELOPE }.toList()
                            .forEach { answer.set<ObjectNode>(it, obj.get(it)) }
                        obj.set<ObjectNode>("finalOutput", answer)
                        "FINAL"
                    }
                    else -> null
                }
                if (inferred != null) obj.put("type", inferred)
            }
            obj.get("finalOutput")?.takeIf { it.isTextual }?.let { text ->
                obj.set<ObjectNode>("finalOutput", mapper.createObjectNode().put("content", text.asText()))
            }
        }
        return mapper.treeToValue(node, AgentAction::class.java)
    }

    /** Top-level field names, for a log line that says what came back without the values. */
    fun fieldNamesOf(json: String): List<String> = runCatching {
        mapper.readTree(json).fieldNames().asSequence().take(12).toList()
    }.getOrDefault(emptyList())

    private fun isBareAnswer(obj: ObjectNode, outputFields: Set<String>): Boolean {
        if (outputFields.isEmpty()) return false
        val names = obj.fieldNames().asSequence().filter { it !in ENVELOPE }.toList()
        return names.isNotEmpty() && names.any { it in outputFields }
    }

    private fun normalizeType(raw: String): String? {
        val t = raw.trim().uppercase().replace(' ', '_').replace('-', '_')
        return when (t) {
            "TOOL_CALL", "CALL", "TOOL", "USE_TOOL" -> "CALL_TOOL"
            "FINISH", "DONE", "ANSWER", "FINAL_ANSWER", "COMPLETE" -> "FINAL"
            "" -> null
            else -> t
        }
    }
}
