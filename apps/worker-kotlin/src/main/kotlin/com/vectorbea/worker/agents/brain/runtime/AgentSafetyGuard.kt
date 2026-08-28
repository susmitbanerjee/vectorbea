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

    /**
     * A tool result, made safe to put back in front of the model and to persist.
     *
     * Separate from [sanitizeReasoningSummary] for one reason: the cap. Reasoning is
     * one sentence and 500 characters is generous for it; a tool result is the DATA
     * the agent asked for, and truncating it to 500 characters would hand back a
     * broken fragment of the rows it needs. Same redaction rules, room to be useful.
     *
     * Specific patterns run before the general one — the bare base64 rule matches the
     * body of a JWT too, and "[REDACTED]" where "[REDACTED-JWT]" belongs makes a
     * credential leak harder to recognise when reading a transcript back.
     */
    fun sanitizeToolOutput(raw: String, maxChars: Int): String {
        val redacted = raw
            .replace(Regex("""sk-[A-Za-z0-9]+"""), "[REDACTED-KEY]")
            .replace(Regex("""eyJ[A-Za-z0-9._-]{50,}"""), "[REDACTED-JWT]")
            .replace(Regex("""[A-Za-z0-9+/]{40,}={0,2}"""), "[REDACTED]")
        return if (redacted.length <= maxChars) redacted
        else redacted.take(maxChars) +
            "… [truncated — ${redacted.length} characters total. Narrow the tool's " +
            "query or select fewer fields if you need the rest.]"
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
