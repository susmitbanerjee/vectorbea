package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentAction
import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.logging.logger
import java.util.UUID

class AgentSafetyGuard {
    private val log = logger()

    /**
     * Is this tool granted?
     *
     * ── AN EMPTY LIST MEANS "ANY TOOL", AND THAT IS A KNOWN FAIL-OPEN ───────
     * The `isNotEmpty()` below means an agent with zero grants passes this check
     * for every tool in the workspace. `shouldUseToolLoop` routes an
     * `iterative_agent` to the loop on its TYPE alone, so such an agent does
     * reach here — this is reachable, not theoretical.
     *
     * Left as-is deliberately: tightening it changes behaviour for agents that
     * run today, and the right fix starts with counting how many rely on it
     * rather than with a patch. [validateAgentAllowed] does NOT copy this.
     */
    fun validateToolAllowed(action: AgentAction, config: AgentBrainConfig) {
        val toolIdStr = action.toolId
            ?: throw ToolNotAllowedException("null", "CALL_TOOL action missing toolId")
        /*
         * A named query is offered as `<toolId>#<queryId>`, and the GRANT is on the
         * tool. Splitting here rather than accepting the composite means a query is
         * reachable exactly when its tool is — one grant, not two — and there is no
         * way to grant a write query without granting the tool that owns it.
         *
         * Whether the query id names something real is the executor's business;
         * this is the allow-list, and it answers one question.
         */
        val baseId = com.vectorbea.worker.agents.tools.NamedQuery.splitToolId(toolIdStr).first
        val toolId = try { UUID.fromString(baseId) }
        catch (_: Exception) { throw ToolNotAllowedException(toolIdStr, "Tool ID is not a valid UUID") }
        if (config.allowedToolIds.isNotEmpty() && toolId !in config.allowedToolIds) {
            log.warn("[brain] TOOL_NOT_ALLOWED agent={} tried toolId={}", config.agentId, toolIdStr)
            throw ToolNotAllowedException(toolIdStr, "Tool $toolIdStr not in allowed list for agent ${config.agentId}")
        }
    }

    /**
     * Is this peer agent on the roster?
     *
     * Validated EXACTLY the way [validateToolAllowed] validates a tool — the
     * target must appear in the grant, the check is here in runtime code and not
     * in the prompt, and an ungranted target is a hard stop. §2: an agent is a
     * callable, exactly like a tool.
     *
     * ── ONE DELIBERATE DIVERGENCE: AN EMPTY ROSTER FAILS CLOSED ────────────
     * [validateToolAllowed] treats an empty grant list as "everything is
     * allowed". That must NOT carry over. An empty roster means the operator has
     * not set one up, and reading that as "may delegate to any agent in the
     * workspace" is an unbounded control-flow edge that undoes the whole grant
     * model — every agent could reach every other, and the depth guard would be
     * the only thing between a misconfigured supervisor and the entire workspace.
     *
     * A TRANSFER is validated through this same function, so there is no path
     * that leaves the roster.
     */
    fun validateAgentAllowed(action: AgentAction, config: AgentBrainConfig) {
        val targets = action.delegationTargets
        if (targets.isEmpty()) {
            throw AgentNotInRosterException("null", "${action.type} action names no target agent")
        }
        /* EVERY target, not just the first. A fan-out that checks one and
           dispatches five is a grant check with a hole exactly the width of the
           fan-out. */
        targets.forEach { validateOneTarget(it, config) }
    }

    private fun validateOneTarget(targetStr: String, config: AgentBrainConfig) {
        val target = try { UUID.fromString(targetStr) }
        catch (_: Exception) {
            throw AgentNotInRosterException(targetStr, "Target agent id is not a valid UUID")
        }
        if (target !in config.canDelegateTo) {
            log.warn("[brain] AGENT_NOT_IN_ROSTER agent={} tried target={}", config.agentId, targetStr)
            throw AgentNotInRosterException(
                targetStr,
                if (config.canDelegateTo.isEmpty())
                    "Agent ${config.agentName} has no team roster, so it cannot delegate to anyone. " +
                    "Add $targetStr to its roster to allow this."
                else
                    "Agent $targetStr is not on ${config.agentName}'s roster")
        }
        /* Delegating to itself is a loop with one node in it. The handoff guard
           would eventually catch it; catching it here names the actual mistake. */
        if (target == config.agentId) {
            throw AgentNotInRosterException(targetStr,
                "Agent ${config.agentName} tried to delegate to itself")
        }
    }

    fun validateActionStructure(action: AgentAction) {
        if (action.type == AgentAction.ActionType.CALL_TOOL && action.toolId.isNullOrBlank())
            throw InvalidActionException("CALL_TOOL missing toolId")
        if (action.type == AgentAction.ActionType.DELEGATE ||
            action.type == AgentAction.ActionType.HANDOFF) {
            if (action.delegationTargets.isEmpty())
                throw InvalidActionException("${action.type} missing targetAgentId")
            /* A tail call goes to exactly one place. Fanning out and then not
               being around to collect the results is not a transfer of control,
               it is an abandonment. */
            if (action.type == AgentAction.ActionType.HANDOFF && action.isBroadcast)
                throw InvalidActionException(
                    "HANDOFF transfers control to ONE agent; use DELEGATE to fan out")
        }
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
            .let { redactOpaque(it) }
        return if (redacted.length <= maxChars) redacted
        else redacted.take(maxChars) +
            "… [truncated — ${redacted.length} characters total. Narrow the tool's " +
            "query or select fewer fields if you need the rest.]"
    }

    fun sanitizeReasoningSummary(summary: String?): String {
        if (summary.isNullOrBlank()) return ""
        return summary.take(500)
            .let { redactOpaque(it) }
            .replace(Regex("""sk-[A-Za-z0-9]+"""), "[REDACTED-KEY]")
            .replace(Regex("""eyJ[A-Za-z0-9._-]{50,}"""), "[REDACTED-JWT]")
    }

    private companion object {
        /** A long run of base64 alphabet — what an unlabelled secret usually looks like. */
        val LONG_OPAQUE = Regex("""[A-Za-z0-9+/]{40,}={0,2}""")

        /** [LONG_OPAQUE] matches, minus the ones that are identifiers rather than secrets. */
        fun redactOpaque(text: String): String = LONG_OPAQUE.replace(text) { m ->
            if (isHexDigest(m.value) || isFilePath(m.value, text, m.range.last + 1)) m.value else "[REDACTED]"
        }

        /**
         * A source path such as `src/main/java/com/acme/billing/InvoiceService`.
         *
         * ── WHY PATHS ARE LEFT ALONE ────────────────────────────────────────
         * Letters and slashes are base64 alphabet, so every Java or Kotlin path of
         * forty characters matched, and a code-review agent was handed
         * `[REDACTED].java` for every changed file — it could name no file and cite
         * no line, and failed saying exactly that.
         *
         * A path is told apart from a token by how it reads, not by its alphabet:
         * slash-separated segments, no `+` or `=` padding, few digits, mostly lower
         * case (base64 is half capitals), and the vowel share of words (a random
         * base64 string has about one vowel in five letters; identifiers have one in
         * three). A file extension straight after the match counts as a second
         * signal and relaxes the vowel bar.
         */
        fun isFilePath(value: String, text: String, end: Int): Boolean {
            if ('/' !in value || '+' in value || value.endsWith('=')) return false
            val segments = value.split('/').filter { it.isNotEmpty() }
            if (segments.size < 2 || segments.any { it.length > 60 }) return false
            /* A commit SHA as one segment (`…/commit/43ef28…`) is exempt on its own
               terms, so it is left out of the word statistics rather than failing
               the digit test for the whole URL path. */
            val words = segments.filterNot { isHexDigest(it) }.joinToString("")
            val letters = words.count { it.isLetter() }
            if (letters == 0) return false
            val vowels = words.count { it.lowercaseChar() in "aeiou" }
            val digits = words.count { it.isDigit() }
            val capitals = words.count { it.isUpperCase() }
            if (digits * 5 > words.length || capitals * 3 > letters) return false
            return if (hasExtensionAt(text, end)) vowels * 5 >= letters
            else segments.size >= 3 && vowels * 4 >= letters
        }

        /** `.java`, `.kt`, `.tsx` … immediately at [index]. */
        private fun hasExtensionAt(text: String, index: Int): Boolean {
            if (index >= text.length || text[index] != '.') return false
            var i = index + 1
            if (i >= text.length || !text[i].isLetter()) return false
            while (i < text.length && text[i].isLetterOrDigit() && i - index <= 8) i++
            return i - index in 2..9 && (i == text.length || !text[i].isLetterOrDigit())
        }

        /**
         * A git commit SHA (40 hex) or a SHA-256 digest (64 hex).
         *
         * ── WHY THESE ARE LEFT ALONE ────────────────────────────────────────
         * The base64 rule matched every commit SHA a GitHub tool returned, so the
         * agent was handed `"sha": "[REDACTED]"`, passed that literal string to
         * `get_commit`, and every code-review workflow failed at its second tool
         * call. A digest identifies content; it is the handle a later call needs,
         * not a credential. Exactly 40 or 64 characters of hex only — a mixed-case
         * base64 token still contains non-hex letters and is still redacted.
         */
        fun isHexDigest(value: String): Boolean =
            (value.length == 40 || value.length == 64) && value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
    }
}

class ToolNotAllowedException(val toolId: String, message: String) : RuntimeException(message)

/** The roster analogue of [ToolNotAllowedException]. Same shape, same handling. */
class AgentNotInRosterException(val targetAgentId: String, message: String) : RuntimeException(message)
class InvalidActionException(message: String) : RuntimeException(message)
