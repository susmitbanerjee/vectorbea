package com.vectorbea.worker.agents.brain.model

import java.util.UUID

/**
 * Full configuration for an iterative agent brain.
 * Loaded from the agents table + node-level overrides.
 */
data class AgentBrainConfig(
    val agentId: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val runId: UUID,
    val stepId: String,
    val agentName: String,
    val role: String?,
    val instructions: String,
    val llmConnectionId: UUID,
    val modelName: String,
    val temperature: Double = 0.2,
    val maxTokens: Int = 2048,
    // Budget limits — hard ceilings, cannot be bypassed
    val maxIterations: Int = 5,
    val maxToolCalls: Int = 5,
    val maxTotalTokens: Int = 16384,
    val maxCostCents: Int = 50,    // default: 50 cents total
    val timeoutMs: Long = 120_000L,
    // Behaviour policies
    val planningMode: String = "none",          // none | short_plan | step_by_step
    val toolChoicePolicy: String = "auto",      // auto | required | restricted
    val stopPolicy: String = "final_output",    // final_output | max_iterations
    val memoryPolicy: String = "run_scoped",    // none | run_scoped
    // Tool permissions — only these tool IDs may be called
    val allowedToolIds: Set<UUID> = emptySet(),
    /**
     * The team roster: agent ids this agent may DELEGATE or HANDOFF to.
     *
     * EMPTY MEANS NO DELEGATION, unlike [allowedToolIds] where empty means "any".
     * See AgentSafetyGuard.validateAgentAllowed for why the two differ.
     */
    val canDelegateTo: Set<UUID> = emptySet(),
    /**
     * This activation, when the run is routed through one.
     *
     * Null for a single-agent run with activations off. Carried on the config
     * because it is what scopes an activation's approval keys and what a
     * delegation records as its parent.
     */
    val activationId: UUID? = null,
    /**
     * How deep this activation sits. 0 for a root.
     *
     * Load-bearing for two things: the depth guard, and the depth-scoped approval
     * keys — a root keeps the step-scoped key that shipped, everything below it
     * gets an activation-scoped one. See AgentBrainRunner.toolApprovalNodeId.
     */
    val depth: Int = 0,
    // Expected output schema (JSON Schema)
    val outputSchemaJson: String = "{}",
    // Task instruction (set by the workflow node, overrides agent-level instruction)
    val taskInstruction: String? = null,
    // Resolved workflow/step input
    val resolvedInput: Map<String, Any?> = emptyMap(),
)
