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

    /**
     * The peer agent to DELEGATE or HANDOFF to.
     *
     * Deliberately a separate field from [toolId] rather than a reuse of it. They
     * are validated against DIFFERENT grant lists, and one field checked against
     * two lists is how a target ends up validated against the wrong one.
     */
    @JsonProperty("targetAgentId")
    val targetAgentId: String? = null,

    /**
     * Several peers at once — a BROADCAST.
     *
     * ── WHY THIS IS NOT AN EIGHTH ACTION ────────────────────────────────────
     * §5.1 lists BROADCAST as a handoff KIND, and §5.3 puts the action set at
     * seven. A fan-out is a DELEGATE with more than one target: the same grant
     * check on every target, the same contract, the same boundary. Adding an
     * eighth action would give the model a second way to express one idea and
     * give the runtime a second dispatch path to keep in step with the first.
     *
     * One target here is the same as [targetAgentId]; the two are merged by
     * `AgentAction.delegationTargets`.
     */
    @JsonProperty("targetAgentIds")
    val targetAgentIds: List<String>? = null,

    /**
     * The task contract for the delegation, as the model wrote it.
     *
     * A map rather than a parsed [com.vectorbea.worker.agents.orchestration.TaskContract]
     * because this is the LLM's raw output: it is untrusted, frequently malformed,
     * and parsing it here would make a bad contract an unparseable ACTION, which
     * the repair path would turn into a THINK. It is parsed at the boundary
     * instead, where a bad contract can be reported as a bad contract.
     */
    @JsonProperty("contract")
    val contract: Map<String, Any?>? = null,
) {
    /**
     * Seven actions. Resist an eighth.
     *
     * The set is call, tail-call, return, think, ask, give up — the smallest one
     * that expresses delegation. Every addition multiplies the states the
     * debugger, the resume path and the join logic each have to handle.
     */
    /**
     * Every peer this action names, in order, de-duplicated.
     *
     * One place that answers "who is this delegation to", so the roster check,
     * the fan-out and the handoff rows cannot disagree about the answer.
     */
    val delegationTargets: List<String>
        get() = (listOfNotNull(targetAgentId) + (targetAgentIds ?: emptyList()))
            .map { it.trim() }.filter { it.isNotEmpty() }.distinct()

    /** True when this delegation fans out. */
    val isBroadcast: Boolean get() = delegationTargets.size > 1

    enum class ActionType {
        THINK,        // internal reasoning step — no external call
        CALL_TOOL,    // call an allowed registered tool
        DELEGATE,     // hand a subtask to a rostered peer and wait for its result
        HANDOFF,      // transfer control to a rostered peer; a tail call, no return
        FINAL,        // produce final output and stop
        ASK_APPROVAL, // request human approval
        FAIL,         // agent decided it cannot complete the task
    }
}
