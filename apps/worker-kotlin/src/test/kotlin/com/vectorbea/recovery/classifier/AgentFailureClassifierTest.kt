package com.vectorbea.recovery.classifier

import com.vectorbea.recovery.model.FailureCategory
import com.vectorbea.recovery.model.FailureEvidence
import kotlin.test.Test
import kotlin.test.assertEquals

/** The agent failures the Incidents page used to file as UNKNOWN. */
class AgentFailureClassifierTest {

    private val classifier = FailureClassifier()

    private fun classify(message: String) = classifier.classify(FailureEvidence(
        workspaceId = "w", environmentId = "e", runId = "r", workflowId = "wf", workflowVersionId = "v",
        failedNodeId = "n-new-agent-2", failedNodeType = "agent", errorMessage = message,
    ))

    @Test
    fun `a token budget breach is a limit, not a context window error`() {
        val c = classify("Step 'Review changes' failed: Agent 'Code reviewer' failed: Budget exceeded: " +
            "Agent exceeded max token budget (16384). Raise Total tokens under Step limits on this step")
        assertEquals(FailureCategory.RESOURCE_LIMIT_EXCEEDED, c.category)
        assertEquals("AGENT_TOKEN_BUDGET_EXCEEDED", c.code)
    }

    @Test
    fun `an agent that gave up, a missing tool input and an unsupported step are named`() {
        assertEquals("AGENT_COULD_NOT_FINISH", classify(
            "Agent 'Code reviewer' failed: The agent stopped and reported: Unable to access the full diff").code)
        assertEquals("TOOL_INPUT_MISSING", classify(
            "'Post to Slack' needs text and got nothing: text comes from steps.write.output.content, which was empty").code)
        assertEquals("STEP_TYPE_UNSUPPORTED", classify("Unsupported node type 'wait'").code)
    }

    @Test
    fun `a model timeout is still a timeout`() {
        assertEquals(FailureCategory.TIMEOUT, classify("LLM call failed: HttpTimeoutException: request timed out").category)
    }
}
