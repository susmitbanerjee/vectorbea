package com.vectorbea.skills

import java.util.UUID

/**
 * A skill, as both services see it: a named, versioned bundle of instructions
 * for a domain, the tools it requires, an output contract, and worked examples.
 *
 * ── WHY THIS IS AN ENTITY AND NOT A LONGER `instructions` FIELD ─────────────
 * An agent granted a video-generation tool does not know how to make a good
 * video. The tool gives it capability; nothing gives it competence. Pasting the
 * competence into the agent's own instructions works exactly once: it cannot be
 * reused by a second agent, it cannot be versioned independently of the agent
 * that happens to hold it, and nothing records that a behaviour change came from
 * the paste rather than from the agent.
 *
 * So a skill is granted the way a tool is granted, and everything that follows
 * from that — the grant check is runtime code against a database, the version is
 * the unit of change, the composition is bounded and recorded — is the same
 * discipline applied to a second kind of callable.
 *
 * ── THE TEXT IN HERE IS DATA ────────────────────────────────────────────────
 * A customer-authored skill's [instructions] reach the model's prompt. That is
 * the same surface an MCP tool description is (MCP.md §4), and it gets the same
 * treatment: sanitized at the write boundary by [SkillSanitizer], and — this is
 * the part that is the security boundary — unable to widen anything, because no
 * string in any prompt is an input to a grant check. See [SkillGrant].
 */
data class Skill(
    val skillId: UUID,
    /** The version actually composed. A grant pins one; see [SkillGrant]. */
    val versionId: UUID,
    /** Monotonic per skill. What a span attribute names, so a behaviour change is attributable. */
    val version: Int,
    val name: String,
    val slug: String,
    val summary: String?,
    /**
     * The body: how to do the thing well.
     *
     * Already sanitized — it was sanitized when it was written, not when it is
     * rendered (invariant 4). A renderer that sanitizes is a renderer somebody
     * forgets to add.
     */
    val instructions: String,
    /** Worked examples, rendered after the instructions. Each is already sanitized. */
    val examples: List<SkillExample> = emptyList(),
    /**
     * What the skill says a good result looks like.
     *
     * Advisory to the MODEL and nothing else: it is not validated by the runtime
     * and never gates an action. The agent's own `outputSchemaJson` is the thing
     * with teeth, and a skill cannot change it — a skill that could rewrite the
     * output contract of every agent holding it would be a grant with no
     * boundary.
     */
    val outputContract: String? = null,
    /**
     * The tools this skill's instructions assume the agent can call.
     *
     * By UUID, because `agents.allowed_tool_ids` grants by UUID (invariant 14)
     * and a requirement expressed in any other vocabulary would be checked
     * against something other than what is enforced. The [ToolRequirement.label]
     * rides along so a refusal can name a tool that has since been deleted.
     */
    val requiredTools: List<ToolRequirement> = emptyList(),
    /**
     * Who wrote it. `FIRST_PARTY` is a claim only the platform can make.
     *
     * Load-bearing in the UI, not in the runtime: both provenances are sanitized
     * identically and neither can widen a grant, so a runtime branch on
     * provenance would be a trust decision with nothing behind it.
     */
    val provenance: Provenance = Provenance.CUSTOMER,
) {
    enum class Provenance { FIRST_PARTY, CUSTOMER }
}

/** One tool a skill needs, and the name to use when saying it is missing. */
data class ToolRequirement(
    val toolId: UUID,
    /**
     * What to call it in a refusal.
     *
     * Stored on the requirement rather than looked up, so "grant the video
     * generation tool first" is still the message after somebody deletes the
     * tool row — which is precisely when the id alone is least useful.
     */
    val label: String,
)

/** One worked example. Both halves reach the prompt, so both are sanitized. */
data class SkillExample(
    val title: String,
    val body: String,
)
