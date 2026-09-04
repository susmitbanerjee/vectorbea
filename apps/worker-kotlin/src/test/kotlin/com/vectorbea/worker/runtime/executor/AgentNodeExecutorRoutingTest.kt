package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.executor.AgentNodeExecutor.Companion.shouldUseToolLoop
import org.junit.jupiter.api.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Which path an AGENT node takes: the tool-calling loop, or a single model call.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * The rule was `agentType == "iterative_agent"`, and everything else fell through to
 * a path with no tool loop at all — one LLM request, return the text.
 *
 * The platform lets you grant tools to ANY agent type. So an agent instructed to
 * "write the result to postgres", with the Postgres tool granted, called the model
 * once, got prose back, and reported success. The run was green and the table was
 * empty, and the event stream said nothing about a skipped tool, because from the
 * executor's point of view nothing had gone wrong — it was never asked to call one.
 *
 * Observed on a real run: AGENT_STARTED → CONNECTION_RESOLVED → LLM_CALL_STARTED →
 * LLM_CALL_COMPLETED → AGENT_COMPLETED, with no AGENT_ITERATION_STARTED and no
 * TOOL_CALL_STARTED anywhere.
 */
class AgentNodeExecutorRoutingTest {

    // ── The types that mean "uses tools" ──────────────────────────────────────

    @Test
    fun `iterative_agent takes the loop`() {
        assertTrue(shouldUseToolLoop("iterative_agent", hasGrantedTools = false, brainEnabled = null))
    }

    @Test
    fun `tool_agent takes the loop even with no tools granted yet`() {
        // A type literally meaning "uses tools" could not call one. An empty grant
        // list is a setup step, not a decision to run it as a single prompt.
        assertTrue(shouldUseToolLoop("tool_agent", hasGrantedTools = false, brainEnabled = null))
    }

    // ── Granted tools are the operator's intent ───────────────────────────────

    @Test
    fun `any agent with granted tools takes the loop`() {
        // THE REPORTED CASE: a native_llm_agent with a Postgres tool granted.
        assertTrue(shouldUseToolLoop("native_llm_agent", hasGrantedTools = true, brainEnabled = null))
    }

    @Test
    fun `router_agent with granted tools takes the loop`() {
        assertTrue(shouldUseToolLoop("router_agent", hasGrantedTools = true, brainEnabled = null))
    }

    @Test
    fun `an agent with no tools and no tool-calling type stays single-shot`() {
        // Unchanged behaviour, and the cheap path: one call, no loop. Routing these
        // into the loop would multiply cost and latency for nothing.
        assertFalse(shouldUseToolLoop("native_llm_agent", hasGrantedTools = false, brainEnabled = null))
    }

    // ── The node-level toggle, which nothing used to read ─────────────────────

    @Test
    fun `brainEnabled true forces the loop`() {
        assertTrue(shouldUseToolLoop("native_llm_agent", hasGrantedTools = false, brainEnabled = true))
    }

    @Test
    fun `brainEnabled false forces the single call even for an iterative agent`() {
        // The override has to work in BOTH directions or it is not an override.
        assertFalse(shouldUseToolLoop("iterative_agent", hasGrantedTools = true, brainEnabled = false))
    }

    @Test
    fun `brainEnabled false forces the single call even with tools granted`() {
        assertFalse(shouldUseToolLoop("native_llm_agent", hasGrantedTools = true, brainEnabled = false))
    }

    @Test
    fun `an absent toggle does not force anything`() {
        // `null` means "not set", which must fall through to the agent's own setup
        // rather than being read as false.
        assertTrue(shouldUseToolLoop("iterative_agent", hasGrantedTools = false, brainEnabled = null))
        assertFalse(shouldUseToolLoop("native_llm_agent", hasGrantedTools = false, brainEnabled = null))
    }

    // ── Unknown types ─────────────────────────────────────────────────────────

    @Test
    fun `an unrecognised type still follows its granted tools`() {
        // New agent types get added; the rule must not depend on knowing them all.
        assertTrue(shouldUseToolLoop("some_future_agent", hasGrantedTools = true, brainEnabled = null))
        assertFalse(shouldUseToolLoop("some_future_agent", hasGrantedTools = false, brainEnabled = null))
    }
}
