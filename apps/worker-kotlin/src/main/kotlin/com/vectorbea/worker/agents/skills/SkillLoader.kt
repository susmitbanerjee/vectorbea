package com.vectorbea.worker.agents.skills

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.vectorbea.skills.Skill
import com.vectorbea.skills.SkillComposer
import com.vectorbea.skills.SkillExample
import com.vectorbea.skills.SkillGrant
import com.vectorbea.skills.ToolRequirement
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * The skills an agent actually holds, at the version each grant resolves to.
 *
 * ── READ AT EXECUTION TIME, NOT PINNED ──────────────────────────────────────
 * Exactly what V042 says about the agent snapshot: the pin covers the
 * DEFINITION and not the GRANT, because a revoked grant is a policy decision
 * and policy is re-read at execution time and fails closed. A skill revoked
 * while a run is parked must stop composing when that run resumes — pinning the
 * grant would let a paused run come back holding something somebody
 * deliberately took away.
 *
 * ── AND THE TOOL CHECK RUNS AGAIN HERE ──────────────────────────────────────
 * `SkillGrant.check` already refused this combination at save time, which is
 * where it is USEFUL. This is where it is ENFORCED, for the same reason: a tool
 * can be revoked a minute after a grant is written. A skill whose tools are no
 * longer granted is DROPPED rather than composed, because its instructions say
 * to call something the runtime will refuse — and an agent spending its whole
 * iteration budget being refused is a wasted run that reads, from outside, like
 * a model that hallucinated a tool.
 *
 * The drop is recorded, never silent. That is the whole discipline: the failure
 * this feature is most likely to cause is an agent that "ignored" a skill it
 * was never shown, and the only defence is that every omission is written down.
 *
 * ── NOTHING HERE IS A PERMISSION ────────────────────────────────────────────
 * Worth stating plainly, because this class reads a grant table and could be
 * mistaken for one. A skill grants NOTHING. `validateToolAllowed` and
 * `validateAgentAllowed` read `allowed_tool_ids` and `canDelegateTo`, take no
 * skill as input, and would behave identically if this file were deleted. The
 * worst a corrupted skill row can do is waste a prompt.
 *
 * ── OPEN, SO A TEST CAN SUPPLY SKILLS WITHOUT POSTGRES ──────────────────────
 * The same seam `AgentBrainFixture` uses for the provider and the approval
 * store. What the loop-level tests assert is what COMPOSED skills do to a
 * prompt and to a grant check, and forcing every one of those through a
 * container would make the cheap tests slow without making them stronger. The
 * query itself is exercised against a real database by
 * `SkillPipelineAcceptanceTest`.
 */
open class SkillLoader(
    private val dataSource: DataSource?,
    /**
     * Off by default, per the standing convention for new runtime behaviour.
     *
     * Off, the loop is byte-for-byte what it was: no query, no prompt section,
     * no rows, no span attributes. Read per call rather than cached so flipping
     * it does not need every worker restarted to take effect on the next run.
     */
    private val enabled: Boolean =
        System.getenv("AGENT_SKILLS_ENABLED")?.lowercase() == "true",
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /** What one activation's skills came to, and what was left out on the way. */
    data class Loaded(
        val skills: List<Skill>,
        /**
         * Skills that were granted and are not being composed because the agent
         * no longer holds a tool they require.
         *
         * Surfaced rather than logged: "this agent has a skill it cannot use" is
         * a configuration problem somebody has to see, and by the time it shows
         * up in a run the person who caused it has moved on.
         */
        val refused: List<SkillGrant.Missing>,
    ) {
        val isEmpty: Boolean get() = skills.isEmpty() && refused.isEmpty()

        companion object {
            val NONE = Loaded(emptyList(), emptyList())
        }
    }

    /**
     * Load this agent's granted skills, dropping any whose tools are gone.
     *
     * ── FAILS TO NOTHING, AND THAT IS SAFE HERE ─────────────────────────────
     * A database error yields no skills rather than an exception. This is the
     * one place in the grant machinery where degrading is correct: a skill adds
     * competence and takes nothing away, so an agent that loses one is worse at
     * its job and no more dangerous. The opposite call — failing the run because
     * a guidance lookup failed — would turn a hint into a dependency.
     *
     * The log line is not decoration: it is how the "why did this agent get
     * worse for twenty minutes" question is answered later.
     */
    open fun load(agentId: UUID, workspaceId: UUID, grantedToolIds: Set<UUID>): Loaded {
        if (!enabled) return Loaded.NONE
        val ds = dataSource ?: return Loaded.NONE

        val granted = runCatching { query(ds, agentId, workspaceId) }.getOrElse {
            log.warn("[skills] load failed for agent={}: {}", agentId, it.message)
            return Loaded.NONE
        }
        if (granted.isEmpty()) return Loaded.NONE

        /*
         * The SAME check the API ran at save time, from the same module, against
         * the same two sets. Two implementations of this would drift, and the
         * drift would be invisible: the form would say a grant is fine and the
         * runtime would quietly disagree.
         */
        val refused = SkillGrant.check(granted, grantedToolIds)
        if (refused.isEmpty()) return Loaded(granted, emptyList())

        val refusedIds = refused.map { it.skillId }.toSet()
        refused.forEach { m ->
            log.warn(
                "[skills] SKILL_DROPPED agent={} skill={} missingTools={}",
                agentId, m.skillName, m.tools.joinToString(",") { it.label },
            )
        }
        return Loaded(granted.filterNot { it.skillId in refusedIds }, refused)
    }

    /**
     * Compose what [load] returned, under the activation's share of the budget.
     *
     * A one-line wrapper on purpose: the budget arithmetic belongs to
     * `SkillComposer` so the save path and this path cannot disagree about it,
     * and putting `budgetFor` at each call site is how one of them ends up
     * computing a different share.
     */
    fun compose(loaded: Loaded, contextCharBudget: Int): SkillComposer.Composed =
        SkillComposer.compose(loaded.skills, SkillComposer.budgetFor(contextCharBudget))

    private fun query(ds: DataSource, agentId: UUID, workspaceId: UUID): List<Skill> =
        ds.connection.use { conn ->
            conn.prepareStatement(
                /*
                 * Workspace-scoped on BOTH joins, not just on the grant row.
                 * Invariant 8: the check is at the boundary, and "an agent belongs
                 * to exactly one workspace" is a fact about data that a bug can
                 * make untrue. The join costs nothing and removes the question.
                 *
                 * COALESCE is the pin: a grant naming a version reads that
                 * version, one that does not follows the skill's current one.
                 */
                """SELECT s.id AS skill_id, s.slug, s.provenance,
                          v.id AS version_id, v.version, v.name, v.summary,
                          v.instructions, v.output_contract,
                          v.examples_json, v.required_tools_json
                     FROM agent_skills g
                     JOIN skills s
                       ON s.id = g.skill_id AND s.workspace_id = g.workspace_id
                     JOIN skill_versions v
                       ON v.id = COALESCE(g.skill_version_id, s.current_version_id)
                      AND v.workspace_id = s.workspace_id
                    WHERE g.agent_id = ? AND g.workspace_id = ? AND s.status = 'active'
                    ORDER BY g.position, s.name"""
            ).use { st ->
                st.setObject(1, agentId)
                st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(
                            Skill(
                                skillId = UUID.fromString(rs.getString("skill_id")),
                                versionId = UUID.fromString(rs.getString("version_id")),
                                version = rs.getInt("version"),
                                name = rs.getString("name"),
                                slug = rs.getString("slug"),
                                summary = rs.getString("summary"),
                                instructions = rs.getString("instructions"),
                                examples = parseExamples(rs.getString("examples_json")),
                                outputContract = rs.getString("output_contract"),
                                requiredTools = parseRequiredTools(rs.getString("required_tools_json")),
                                provenance = if (rs.getString("provenance") == "first_party")
                                    Skill.Provenance.FIRST_PARTY else Skill.Provenance.CUSTOMER,
                            )
                        )
                    }
                }
            }
        }

    /*
     * A column that will not parse yields an empty list rather than throwing.
     * These are written by our own API and are well formed on every path that
     * exists; parsing defensively anyway because a malformed examples array must
     * cost an agent its worked examples, not its run.
     *
     * The required-tools case is the one worth being explicit about: an empty
     * list makes SkillGrant.check pass vacuously for that skill. Safe only
     * because this check is a usability guard and never a permission — the tool
     * grant itself is enforced by `validateToolAllowed` against
     * `allowed_tool_ids`, which reads no JSON at all.
     */
    private fun parseExamples(raw: String?): List<SkillExample> = runCatching {
        mapper.readValue<List<Map<String, String>>>(raw ?: "[]").mapNotNull {
            val t = it["title"]; val b = it["body"]
            if (t != null && b != null) SkillExample(t, b) else null
        }
    }.getOrElse { emptyList() }

    private fun parseRequiredTools(raw: String?): List<ToolRequirement> = runCatching {
        mapper.readValue<List<Map<String, String>>>(raw ?: "[]").mapNotNull {
            val id = it["toolId"]?.let { s -> runCatching { UUID.fromString(s) }.getOrNull() }
            if (id != null) ToolRequirement(id, it["label"] ?: id.toString()) else null
        }
    }.getOrElse { emptyList() }
}
