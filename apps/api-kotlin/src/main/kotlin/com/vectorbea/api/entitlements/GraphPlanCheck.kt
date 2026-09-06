package com.vectorbea.api.entitlements

import com.vectorbea.graph.WorkflowGraph
import org.slf4j.LoggerFactory

/**
 * Plan enforcement for a workflow graph, at SAVE time.
 *
 * ── WHY SAVE TIME AND NOT RUN TIME ──────────────────────────────────────────
 * A team of twelve on a plan that allows eight is a mistake somebody made in a
 * builder, five seconds ago, with the canvas in front of them. Refused at save,
 * it is a form error they fix immediately. Refused at run time it is a
 * production failure at 3am, in a workflow that has been green for a week,
 * belonging to somebody who did not write it and cannot tell whether the plan
 * changed or the graph did.
 *
 * The runtime still has its own ceilings — `TeamLimits.maxDepth` and the safety
 * guard's roster check — and those stay. This is not a replacement for them: a
 * graph can be saved under one plan and run under another, so the runtime must
 * still bound what it executes. What this adds is the chance to say no while the
 * author is still in the room.
 *
 * ── THE GOVERNING RULE ──────────────────────────────────────────────────────
 * Checked against the WORKSPACE the workflow lives in. A Pro member saving a
 * workflow into a Free workspace gets Free's team size, and the refusal names
 * Free.
 *
 * ── ONE READER OF graph_json ────────────────────────────────────────────────
 * Parsed through [WorkflowGraph], the same reader the worker uses. The graph
 * arrives in one of three dialects — React Flow, the internal flat form, and the
 * Architect's — and every one of them puts a node's config somewhere different.
 * A second parser here would have found teams in one dialect and not the others,
 * which is a limit that silently does not apply to whichever builder the
 * customer happens to use.
 */
object GraphPlanCheck {

    private val log = LoggerFactory.getLogger(GraphPlanCheck::class.java)

    private val TEAM_TYPES = setOf("agent_team", "team")
    private val MCP_TYPES = setOf("mcp_tool", "mcp")

    /**
     * Refuse a graph the workspace's plan does not allow.
     *
     * [graphJson] is the version's graph as it will be stored. Parse failures are
     * IGNORED rather than refused: the shape validation that owns "is this a
     * valid graph" runs beside this, and a plan check that also became a syntax
     * check would reject a draft for the wrong reason and in the wrong words.
     */
    fun enforce(guard: EntitlementGuard, workspaceId: java.util.UUID, graphJson: String) {
        val graph = runCatching { WorkflowGraph.parse(graphJson) }.getOrElse {
            log.debug("[entitlements] graph unparseable for plan check, skipping: {}", it.message)
            return
        }

        val teamNodes = graph.nodes.filter { it.type.lowercase() in TEAM_TYPES }
        val mcpNodes = graph.nodes.filter { it.type.lowercase() in MCP_TYPES }

        // Nothing gated in this graph — do not resolve, do not touch the database.
        // A draft with three transforms in it should cost no plan lookup at all.
        if (teamNodes.isEmpty() && mcpNodes.isEmpty()) return

        val eff = guard.resolve(workspaceId)

        if (mcpNodes.isNotEmpty()) {
            guard.requireFeature(workspaceId, EntitlementKeys.MCP_TOOLS)
        }

        if (teamNodes.isEmpty()) return
        guard.requireFeature(workspaceId, EntitlementKeys.TEAMS)

        for (node in teamNodes) {
            val roster = node.config["roster"] as? List<*> ?: emptyList<Any?>()

            // `requireConfiguredValue`, not `requireLimit`: the roster size IS the
            // configured number, so the comparison is `>` and not `>=`. A plan
            // allowing 8 must accept a team of exactly 8. Getting these two
            // confused is the off-by-one that either locks a customer out one
            // short of what they bought or quietly sells them one extra.
            guard.requireConfiguredValue(eff, EntitlementKeys.MAX_TEAM_SIZE, roster.size.toLong())

            // Delegation is a feature before it is a depth. A roster where
            // somebody can delegate to somebody else uses it, whatever depth the
            // node declares.
            val delegates = roster.any { m ->
                ((m as? Map<*, *>)?.get("canDelegateTo") as? List<*>)?.isNotEmpty() == true
            }
            if (delegates) guard.requireFeature(workspaceId, EntitlementKeys.DELEGATION)

            @Suppress("UNCHECKED_CAST")
            val limits = node.config["limits"] as? Map<String, Any?> ?: emptyMap()
            val declaredDepth = (limits["maxDepth"] as? Number)?.toInt()
            if (declaredDepth != null) {
                if (declaredDepth > 0) guard.requireFeature(workspaceId, EntitlementKeys.DELEGATION)
                guard.requireConfiguredValue(
                    eff, EntitlementKeys.MAX_DELEGATION_DEPTH, declaredDepth.toLong())
            }
        }
    }
}
