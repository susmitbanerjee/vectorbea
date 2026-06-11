package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentAction
import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.logging.logger
import java.util.UUID

class AgentSafetyGuard {
    private val log = logger()

    fun validateToolAllowed(action: AgentAction, config: AgentBrainConfig) {
        val toolIdStr = action.toolId
            ?: throw ToolNotAllowedException("null", "CALL_TOOL action missing toolId")
        val toolId = try { UUID.fromString(toolIdStr) }
        catch (_: Exception) { throw ToolNotAllowedException(toolIdStr, "Tool ID is not a valid UUID") }
        if (config.allowedToolIds.isNotEmpty() && toolId !in config.allowedToolIds) {
            log.warn("[brain] TOOL_NOT_ALLOWED agent={} tried toolId={}", config.agentId, toolIdStr)
            throw ToolNotAllowedException(toolIdStr, "Tool $toolIdStr not in allowed list for agent ${config.agentId}")
        }
    }

    fun validateActionStructure(action: AgentAction) {
        if (action.type == AgentAction.ActionType.CALL_TOOL && action.toolId.isNullOrBlank())
            throw InvalidActionException("CALL_TOOL missing toolId")
    }

    fun sanitizeReasoningSummary(summary: String?): String {
        if (summary.isNullOrBlank()) return ""
        return summary.take(500)
            .replace(Regex("""[A-Za-z0-9+/]{40,}"""), "[REDACTED]")
            .replace(Regex("""sk-[A-Za-z0-9]+"""), "[REDACTED-KEY]")
            .replace(Regex("""eyJ[A-Za-z0-9._-]{50,}"""), "[REDACTED-JWT]")
    }
}

class ToolNotAllowedException(val toolId: String, message: String) : RuntimeException(message)
class InvalidActionException(message: String) : RuntimeException(message)
