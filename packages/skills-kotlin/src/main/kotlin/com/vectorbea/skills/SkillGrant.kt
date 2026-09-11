package com.vectorbea.skills

import java.util.UUID

/**
 * Whether an agent may hold a set of skills, and what is missing when it may not.
 *
 * ── THE WHOLE POINT IS *WHEN* THIS RUNS ─────────────────────────────────────
 * A skill's instructions say "call the video generation tool with a shot list".
 * If the agent holding that skill has no such grant, the failure happens at
 * iteration four of a production run: the model does exactly what it was taught,
 * the runtime refuses the call (invariant 1, correctly), and what an operator
 * sees is an agent that appears to have hallucinated a tool. It did not. It was
 * told to use one, by a bundle somebody granted it without the tools it names.
 *
 * That is a CONFIGURATION error and it is knowable at save time, so it is
 * refused at save time, with the missing tools named — the same argument
 * `AgentRoutes` already makes for `max_agents`: a configuration refused when it
 * is written is a form error the author fixes in the moment; the same
 * configuration refused when it runs is a production failure at 3am in a
 * workflow that has been green for a week, belonging to somebody who did not
 * write it.
 *
 * ── AND IT RUNS AGAIN AT EXECUTION TIME ─────────────────────────────────────
 * Save time is where it is USEFUL; it is not where it is enforced. A tool can be
 * revoked a minute after a grant is saved, and V042's note says why the pin
 * covers the definition and not the grant: policy is re-read at execution time
 * and fails closed. So the loader calls [missingTools] again on every activation
 * and drops any skill whose tools are no longer granted, naming the drop. Same
 * function, same answer, two moments.
 *
 * ── PURE, AND THAT IS DELIBERATE ────────────────────────────────────────────
 * No I/O. Both callers already hold the two sets — the API from the request it
 * is validating, the worker from the config it is running — and a version of
 * this that queried would be a version each caller had to mock.
 */
object SkillGrant {

    /**
     * What [check] found wrong, in the vocabulary a person can act on.
     *
     * A list rather than the first failure: an author who granted three skills
     * and is missing four tools should fix four things once, not discover them
     * one save at a time.
     */
    data class Missing(
        val skillId: UUID,
        val skillName: String,
        /** The tools this skill needs that the agent does not have. Never empty. */
        val tools: List<ToolRequirement>,
    )

    /**
     * The tools [skill] needs that [grantedToolIds] does not contain.
     *
     * ── AN EMPTY GRANT LIST IS NOT "EVERYTHING" HERE ────────────────────────
     * `AgentSafetyGuard.validateToolAllowed` treats an empty `allowed_tool_ids`
     * as "any tool", a documented fail-open kept because tightening it would
     * change behaviour for agents that run today. That reading must NOT carry
     * over. An agent with no grants that is handed a skill requiring three tools
     * has three missing tools, and saying otherwise would make the refusal
     * vacuous for exactly the agents most likely to be misconfigured — the ones
     * nobody has finished setting up.
     *
     * The divergence is the same one the roster makes and for the same reason:
     * a new grant model does not inherit an old model's known hole.
     */
    fun missingTools(skill: Skill, grantedToolIds: Set<UUID>): List<ToolRequirement> =
        skill.requiredTools.filterNot { it.toolId in grantedToolIds }

    /**
     * Every skill in [skills] whose required tools are not all granted.
     *
     * Empty means the grant is legal. The caller decides what to do with a
     * non-empty answer: the API refuses the write, the loader drops the skill
     * and records why.
     */
    fun check(skills: List<Skill>, grantedToolIds: Set<UUID>): List<Missing> =
        skills.mapNotNull { skill ->
            missingTools(skill, grantedToolIds)
                .takeIf { it.isNotEmpty() }
                ?.let { Missing(skill.skillId, skill.name, it) }
        }

    /**
     * The refusal, as a sentence.
     *
     * Active voice, states what happened and how to fix it — the copy rules
     * apply to an API error as much as to a toast, because this string is what
     * the form renders.
     */
    fun explain(missing: List<Missing>): String {
        if (missing.isEmpty()) return ""
        val parts = missing.joinToString("; ") { m ->
            "${m.skillName} needs ${m.tools.joinToString(", ") { it.label }}"
        }
        return "This agent is missing tools that its skills require: $parts. " +
            "Grant those tools to the agent, or remove the skills that need them."
    }

    /**
     * The machine-readable half, for a form that highlights fields.
     *
     * Ids as strings because that is what crosses the wire, and grouped by skill
     * because that is how the form is laid out — one row per granted skill, with
     * its own unmet requirements under it.
     */
    fun details(missing: List<Missing>): List<Map<String, Any?>> = missing.map { m ->
        mapOf(
            "skillId" to m.skillId.toString(),
            "skillName" to m.skillName,
            "missingTools" to m.tools.map {
                mapOf("toolId" to it.toolId.toString(), "label" to it.label)
            },
        )
    }
}
