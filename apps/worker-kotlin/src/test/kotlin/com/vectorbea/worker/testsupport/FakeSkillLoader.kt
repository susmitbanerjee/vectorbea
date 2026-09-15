package com.vectorbea.worker.testsupport

import com.vectorbea.skills.Skill
import com.vectorbea.skills.SkillGrant
import com.vectorbea.worker.agents.skills.SkillLoader
import java.util.UUID

/**
 * The skills an agent holds, without a database.
 *
 * The same argument [AgentBrainFixture] makes about the provider: what the
 * loop-level tests assert is what COMPOSED skills do to a prompt and to a grant
 * check, and routing every one of those through a container would make the
 * cheap tests slow without making them stronger. The query, the grant rows and
 * the version resolution are exercised for real by `SkillPipelineAcceptanceTest`
 * and by the API's `SkillGrantAcceptanceTest`.
 *
 * Note what this does NOT fake: [SkillGrant.check]. When [enforceToolCheck] is
 * on, the real check runs against the real granted set, because "a skill whose
 * tool was revoked is dropped" is a claim about that function and faking it
 * would assert nothing.
 */
class FakeSkillLoader(
    private val skills: List<Skill>,
    /**
     * Whether to run the real tool re-check against the agent's grant.
     *
     * Off by default so the injection tests can put a skill in front of the
     * model without also having to grant it tools — the point there is that the
     * TEXT changes nothing, and a loader that refused to compose it would hide
     * the very thing under test.
     */
    private val enforceToolCheck: Boolean = false,
) : SkillLoader(dataSource = null, enabled = true) {

    override fun load(agentId: UUID, workspaceId: UUID, grantedToolIds: Set<UUID>): Loaded {
        if (!enforceToolCheck) return Loaded(skills, emptyList())
        val refused = SkillGrant.check(skills, grantedToolIds)
        val refusedIds = refused.map { it.skillId }.toSet()
        return Loaded(skills.filterNot { it.skillId in refusedIds }, refused)
    }
}
