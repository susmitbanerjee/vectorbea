package com.vectorbea.worker.agents.brain.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

/**
 * Structured action returned by the LLM during an agent loop iteration.
 *
 * The LLM ONLY selects an action — it does NOT execute tools itself.
 * The runtime validates and executes the action.
 *
 * Example JSON from LLM:
 * {
 *   "type": "CALL_TOOL",
 *   "reasoningSummary": "Need invoices to assess churn risk.",
 *   "toolId": "billing-api-get-invoices",
 *   "toolInput": { "customerId": "cus_123" }
 * }
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class AgentAction(
    @JsonProperty("type")
    val type: ActionType,

    /** ONE-SENTENCE summary of reasoning — sanitized before storage */
    @JsonProperty("reasoningSummary")
    val reasoningSummary: String? = null,

    /** Tool ID from the allowed tools list */
    @JsonProperty("toolId")
    val toolId: String? = null,

    /** Inputs for the tool call */
    @JsonProperty("toolInput")
    val toolInput: Map<String, Any?> = emptyMap(),

    /** Final structured output — must match outputSchemaJson */
    @JsonProperty("finalOutput")
    val finalOutput: Map<String, Any?> = emptyMap(),

    /** Confidence score 0.0–1.0 */
    @JsonProperty("confidence")
    val confidence: Double? = null,

    /** Reason used when type = FAIL */
    @JsonProperty("failReason")
    val failReason: String? = null,
) {
    enum class ActionType {
        THINK,        // internal reasoning step — no external call
        CALL_TOOL,    // call an allowed registered tool
        FINAL,        // produce final output and stop
        ASK_APPROVAL, // request human approval
        FAIL,         // agent decided it cannot complete the task
    }
}
