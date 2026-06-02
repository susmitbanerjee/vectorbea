package com.vectorbea.api.architect

/**
 * Builds the system + user prompts for the AI Workflow Architect planning LLM.
 * Security: never includes secrets, credentials, or other tenants' data.
 */
object WorkflowArchitectPromptBuilder {

    private val PLAN_SCHEMA = """
{
  "workflowName": "string",
  "workflowDescription": "string",
  "goalSummary": "string",
  "confidence": "number 0-1",
  "trigger": {
    "type": "manual|schedule|webhook|api_event",
    "description": "string",
    "scheduleSuggestion": "string|null"
  },
  "requiredInputs": [{"key":"string","label":"string","type":"string|number|boolean|object","required":true,"description":"string","example":"any"}],
  "agents": [{
    "tempId":"string","name":"string","type":"native_llm_agent|iterative_agent|router_agent",
    "role":"string","instructions":"string","modelPreference":"string|null",
    "requiresLlmConnection":true,"allowedToolTempIds":["string"],"outputSchema":{}
  }],
  "tools": [{
    "tempId":"string","name":"string","type":"http_api|database_read|database_write|transform|webhook|email|generic_tool",
    "description":"string","requiredConnection":{"type":"llm_provider|http_api|database|webhook|none","providerHint":"string|null","description":"string"},
    "riskLevel":"low|medium|high","requiresApproval":false,"inputSchema":{},"outputSchema":{},"configurationQuestions":["string"]
  }],
  "approvalGates": [{"tempId":"string","name":"string","reason":"string","approverRole":"string","approvalMessage":"string","riskLevel":"low|medium|high"}],
  "steps": [{
    "tempId":"string","name":"string","type":"trigger|agent|tool|approval|branch|transform|join|end",
    "description":"string","agentTempId":"string|null","toolTempId":"string|null","approvalTempId":"string|null",
    "inputMappings":{},"outputContract":{},"dependsOn":["string"],"parallelGroup":"string|null",
    "branchCondition":null,"retryPolicy":{"maxAttempts":2,"backoffMs":2000},"timeoutMs":30000
  }],
  "edges": [{"from":"string","to":"string","type":"success|failure|condition_true|condition_false|parallel|join","label":"string|null"}],
  "requiredConnections": [{
    "tempId":"string","name":"string","type":"llm_provider|http_api|database|webhook",
    "providerHint":"string|null","usedBy":["string"],"requiredForSimulation":false,"requiredForRealExecution":true,
    "setupInstructions":"string","fieldsNeeded":[{"key":"string","label":"string","secret":true,"type":"string","required":true}]
  }],
  "safetyNotes": ["string"],
  "simulationPlan": {"canSimulateWithoutConnections":true,"sampleOutputsNeeded":["string"],"suggestedDemoData":{}},
  "questionsBeforeCreation": ["string"]
}
""".trim()

    fun buildSystemPrompt(workspaceLimits: Map<String, Any>): String = """
You are Vectorbea AI Workflow Architect. Your job is to convert a user's automation goal into a practical, safe, durable workflow plan.

RULES:
1. Output ONLY valid JSON matching the schema below. No markdown, no explanation outside the JSON.
2. Use the MINIMUM number of agents and tools required.
3. Add approval gates before any high-risk write operations (database_write, CRM updates, email sends, billing).
4. Default to simulation-first (canSimulateWithoutConnections=true when possible).
5. Never include secrets, credentials, or raw API keys in the plan.
6. Do not design overly complex workflows. Prefer simple sequential flows unless parallel is clearly needed.
7. Assign unique tempId values like "step_1", "agent_1", "tool_1", "conn_1" etc.
8. Ensure every step is connected via edges. Every workflow must end with an "end" step.
9. The first step must always be the trigger.
10. If you cannot create a valid plan, set confidence to 0 and explain in goalSummary.

WORKSPACE LIMITS: ${workspaceLimits.entries.joinToString(", ") { "${it.key}=${it.value}" }}

SUPPORTED NODE TYPES: trigger, agent, tool, approval, branch, transform, join, end
SUPPORTED TOOL TYPES: http_api, database_read, database_write, transform, webhook, email, generic_tool
SUPPORTED AGENT TYPES: native_llm_agent, iterative_agent, router_agent

OUTPUT JSON SCHEMA:
$PLAN_SCHEMA
""".trimIndent()

    fun buildPlanningPrompt(goal: String, answers: Map<String, String> = emptyMap()): String {
        val answerContext = if (answers.isNotEmpty()) {
            "\n\nUSER CLARIFICATIONS:\n" + answers.entries.joinToString("\n") { "- ${it.key}: ${it.value}" }
        } else ""
        return "Create a workflow plan for this automation goal:\n\n\"$goal\"$answerContext"
    }

    fun buildRevisionPrompt(instruction: String, existingPlanJson: String): String =
        "Revise this workflow plan according to the instruction.\n\n" +
        "INSTRUCTION: \"$instruction\"\n\n" +
        "EXISTING PLAN:\n$existingPlanJson\n\n" +
        "Return the complete revised plan as valid JSON."

    fun buildRepairPrompt(brokenJson: String, error: String): String =
        "The following workflow plan JSON is invalid. Fix it to match the schema exactly.\n\n" +
        "ERROR: $error\n\n" +
        "BROKEN JSON:\n$brokenJson\n\n" +
        "Return only valid JSON."

    fun buildClarificationPrompt(goal: String): String =
        "A user wants to create this automation: \"$goal\"\n\n" +
        "If this goal is clear enough to plan immediately, respond with: {\"needsClarification\":false,\"questions\":[]}\n" +
        "If the goal is vague, respond with up to 5 short clarifying questions: {\"needsClarification\":true,\"questions\":[\"...\"]}\n" +
        "Focus on: data sources, output destinations, frequency, approval requirements, LLM preferences."
}
