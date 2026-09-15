package com.vectorbea.skills

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The grant check, as a pure function: which required tools are missing.
 *
 * The refusal itself — an HTTP 422 with the missing list, at save time — is
 * `SkillGrantAcceptanceTest` in the API, against a real database. This asserts
 * the ANSWER; that asserts somebody asks the question at the right moment.
 */
class SkillGrantTest {

    private val videoTool = UUID.randomUUID()
    private val searchTool = UUID.randomUUID()
    private val ttsTool = UUID.randomUUID()

    private fun skill(name: String, vararg req: Pair<UUID, String>) = Skill(
        skillId = UUID.randomUUID(),
        versionId = UUID.randomUUID(),
        version = 1,
        name = name,
        slug = name.lowercase(),
        summary = null,
        instructions = "…",
        requiredTools = req.map { ToolRequirement(it.first, it.second) },
    )

    @Test
    fun `a skill whose tools are all granted is legal`() {
        val s = skill("Video", videoTool to "Video generation")
        assertTrue(SkillGrant.check(listOf(s), setOf(videoTool, searchTool)).isEmpty())
    }

    @Test
    fun `a missing tool is named, with the label the skill author gave it`() {
        val s = skill("Video", videoTool to "Video generation")
        val missing = SkillGrant.check(listOf(s), setOf(searchTool))
        assertEquals(1, missing.size)
        assertEquals("Video generation", missing.single().tools.single().label)
        assertTrue(SkillGrant.explain(missing).contains("Video needs Video generation"))
    }

    @Test
    fun `every missing tool across every skill is reported at once`() {
        /* An author who granted three skills and is missing four tools should fix
           four things once, not discover them one save at a time. */
        val missing = SkillGrant.check(
            listOf(
                skill("Video", videoTool to "Video generation", ttsTool to "Narration"),
                skill("Research", searchTool to "Web search"),
            ),
            grantedToolIds = emptySet(),
        )
        assertEquals(2, missing.size)
        assertEquals(3, missing.sumOf { it.tools.size })
    }

    @Test
    fun `an empty grant list is not read as everything`() {
        /*
         * `AgentSafetyGuard.validateToolAllowed` treats an empty allowed_tool_ids
         * as "any tool" — a documented fail-open. Inheriting it here would make
         * the refusal vacuous for exactly the agents most likely to be
         * misconfigured: the ones nobody has finished setting up.
         */
        val s = skill("Video", videoTool to "Video generation")
        assertEquals(1, SkillGrant.check(listOf(s), emptySet()).size)
    }

    @Test
    fun `a skill requiring nothing is legal against any grant`() {
        assertTrue(SkillGrant.check(listOf(skill("Style")), emptySet()).isEmpty())
    }

    @Test
    fun `the refusal says how to fix it`() {
        val missing = SkillGrant.check(listOf(skill("Video", videoTool to "Video generation")), emptySet())
        val text = SkillGrant.explain(missing)
        assertTrue(text.contains("Grant those tools to the agent"))
        assertTrue(text.contains("remove the skills that need them"))
    }

    @Test
    fun `the machine readable half carries ids a form can highlight`() {
        val missing = SkillGrant.check(listOf(skill("Video", videoTool to "Video generation")), emptySet())
        val details = SkillGrant.details(missing).single()
        @Suppress("UNCHECKED_CAST")
        val tools = details["missingTools"] as List<Map<String, Any?>>
        assertEquals(videoTool.toString(), tools.single()["toolId"])
    }

    @Test
    fun `explain on an empty list is empty, not a sentence about nothing`() {
        assertEquals("", SkillGrant.explain(emptyList()))
    }
}
