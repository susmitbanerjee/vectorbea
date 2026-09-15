package com.vectorbea.recovery.classifier

import com.vectorbea.recovery.model.*

/**
 * Failures an agent step reports about itself: a limit it ran into, or giving up.
 *
 * Before this every one of them reached [UnknownFailureClassifier], so the
 * Incidents page grouped a token budget, an iteration limit and "the agent said it
 * could not see the diff" under one UNKNOWN row — and the LLM classifier, which
 * matches "max token", misfiled a token-BUDGET breach as a context-window error.
 * Runs before [LlmFailureClassifier] for that reason.
 *
 * Also catches two step failures that are not agent-specific but read the same
 * way from here: a tool that was handed an empty required input, and a node type
 * this worker does not run.
 */
class AgentFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg = e.errorMessage?.lowercase() ?: return null
        return when {
            msg.contains("exceeded max token budget") || (msg.contains("budget exceeded") && msg.contains("token")) ->
                limit("AGENT_TOKEN_BUDGET_EXCEEDED",
                    "The agent used its whole token budget before finishing.",
                    "Raise Total tokens under Step limits on this step, or give the agent less to read.")
            msg.contains("exceeded max tool calls") ->
                limit("AGENT_TOOL_CALL_LIMIT",
                    "The agent reached its tool call limit before finishing.",
                    "Raise Tool calls under Step limits on this step.")
            msg.contains("exceeded max iterations") || msg.contains("max_iterations") ->
                limit("AGENT_ITERATION_LIMIT",
                    "The agent reached its step limit before finishing.",
                    "Raise Max iterations on the agent, or make the task narrower.")
            msg.contains("exceeded max cost") ->
                limit("AGENT_COST_LIMIT",
                    "The agent reached its cost limit before finishing.",
                    "Raise Cost under Step limits on this step.")
            msg.contains("agent stopped and reported") || msg.contains("stopreason=agent_failed") ->
                FailureClassification(FailureCategory.TOOL_RESPONSE_INVALID, "AGENT_COULD_NOT_FINISH", FailureSeverity.MEDIUM,
                    retryable = false,
                    summary = "The agent stopped because it could not complete the task.",
                    technicalSummary = e.errorMessage?.take(500))
            msg.contains("needs ") && msg.contains(" and got nothing") ->
                FailureClassification(FailureCategory.MAPPING_FAILURE, "TOOL_INPUT_MISSING", FailureSeverity.MEDIUM,
                    retryable = false,
                    summary = "A tool was run without a value it requires.",
                    technicalSummary = e.errorMessage?.take(500))
            msg.contains("unsupported node type") ->
                FailureClassification(FailureCategory.WORKFLOW_GRAPH_INVALID, "STEP_TYPE_UNSUPPORTED", FailureSeverity.HIGH,
                    retryable = false,
                    summary = "The workflow has a step type that cannot run yet.",
                    technicalSummary = e.errorMessage?.take(500))
            else -> null
        }
    }

    private fun limit(code: String, summary: String, fix: String) =
        FailureClassification(FailureCategory.RESOURCE_LIMIT_EXCEEDED, code, FailureSeverity.MEDIUM,
            retryable = false, summary = "$summary $fix")
}
