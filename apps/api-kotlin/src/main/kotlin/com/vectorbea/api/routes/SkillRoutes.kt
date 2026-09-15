package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.api.requireMaxLength
import com.vectorbea.api.api.slugify
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.AgentRepository
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.SkillCatalogRow
import com.vectorbea.api.repository.SkillGrantRow
import com.vectorbea.api.repository.SkillRepository
import com.vectorbea.api.repository.SkillRow
import com.vectorbea.api.repository.SkillVersionRow
import com.vectorbea.api.repository.ToolRepository
import com.vectorbea.skills.Skill
import com.vectorbea.skills.SkillComposer
import com.vectorbea.skills.SkillExample
import com.vectorbea.skills.SkillGrant
import com.vectorbea.skills.SkillSanitizer
import com.vectorbea.skills.ToolRequirement
import org.slf4j.LoggerFactory
import java.util.UUID

private val log = LoggerFactory.getLogger(SkillRoutes::class.java)

// ── Request bodies ────────────────────────────────────────────────────────────

private data class ExampleBody(val title: String?, val body: String?)

private data class RequiredToolBody(val toolId: String?, val label: String?)

private data class CreateSkillBody(
    val name: String?,
    val slug: String? = null,
    val description: String? = null,
    val summary: String? = null,
    val instructions: String?,
    val outputContract: String? = null,
    val examples: List<ExampleBody>? = null,
    val requiredTools: List<RequiredToolBody>? = null,
)

private data class NewVersionBody(
    val name: String? = null,
    val summary: String? = null,
    val instructions: String?,
    val outputContract: String? = null,
    val examples: List<ExampleBody>? = null,
    val requiredTools: List<RequiredToolBody>? = null,
    val changeSummary: String? = null,
)

private data class InstallBody(
    val version: Int? = null,
    val slug: String? = null,
    /** capability key -> tool uuid. Every declared capability must appear. */
    val toolBindings: Map<String, String>? = null,
)

private data class GrantBody(val skillId: String?, val skillVersionId: String? = null)

private data class SetGrantsBody(val skills: List<GrantBody>?)

// ── Responses ─────────────────────────────────────────────────────────────────

private fun SkillRow.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "workspaceId" to workspaceId.toString(),
    "environmentId" to environmentId.toString(),
    "name" to name,
    "slug" to slug,
    "description" to description,
    "provenance" to provenance,
    "catalogEntryId" to catalogEntryId?.toString(),
    "currentVersionId" to currentVersionId?.toString(),
    "currentVersion" to currentVersion,
    "status" to status,
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
)

private fun SkillVersionRow.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "skillId" to skillId.toString(),
    "version" to version,
    "name" to name,
    "summary" to summary,
    "instructions" to instructions,
    "outputContract" to outputContract,
    "examples" to examples.map { mapOf("title" to it.title, "body" to it.body) },
    "requiredTools" to requiredTools.map {
        mapOf("toolId" to it.toolId.toString(), "label" to it.label)
    },
    /* Surfaced, not hidden. A version whose text tripped the frame-impersonation
       rules is still installed and still composes — the sanitizer never rejects —
       so the only way anybody learns it happened is if the API says so. */
    "flaggedForReview" to flaggedForReview,
    "changeSummary" to changeSummary,
    "createdAt" to createdAt.toString(),
)

private fun SkillCatalogRow.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "slug" to slug,
    "version" to version,
    "name" to name,
    "summary" to summary,
    "category" to category,
    "instructions" to instructions,
    "outputContract" to outputContract,
    "examples" to examples.map { mapOf("title" to it.title, "body" to it.body) },
    "requiredCapabilities" to requiredCapabilities.map {
        mapOf("key" to it.key, "label" to it.label, "why" to it.why)
    },
    /* The library is first-party BY CONSTRUCTION — the table has no workspace
       column, so nothing a customer writes can reach it. Stated in the response
       because the UI renders a provenance badge and should read the fact rather
       than infer it from the endpoint it called. */
    "provenance" to "first_party",
)

/**
 * Skills: the library, a workspace's own bundles, their versions, and the grant.
 *
 * ── THE ONE ROUTE THAT MATTERS IS `PUT /api/agents/:id/skills` ──────────────
 * Everything else here is CRUD. The grant endpoint is where the feature's
 * central promise is kept: granting a skill without its required tools is
 * REFUSED, with the missing list, at save time.
 *
 * Why refuse rather than warn: a skill's instructions say "call the video
 * generation tool with a shot list". An agent holding that skill and not that
 * tool does exactly what it was taught, gets refused by the runtime (invariant
 * 1, correctly), and presents as an agent that hallucinated a tool. It did not.
 * Somebody granted it a bundle naming tools it does not have, and that was
 * knowable the moment they pressed save.
 */
class SkillRoutes(
    private val repo: SkillRepository,
    private val agentRepo: AgentRepository,
    private val toolRepo: ToolRepository,
) {
    fun register(router: Router) {
        router.get("/api/skills", ::list)
        router.post("/api/skills", ::create)
        router.get("/api/skills/:id", ::getById)
        router.delete("/api/skills/:id", ::archive)
        router.get("/api/skills/:id/versions", ::listVersions)
        router.post("/api/skills/:id/versions", ::addVersion)
        router.get("/api/skills/:id/agents", ::listHolders)

        router.get("/api/skill-catalog", ::listCatalog)
        router.post("/api/skill-catalog/:slug/install", ::install)

        router.get("/api/agents/:id/skills", ::listGrants)
        router.put("/api/agents/:id/skills", ::setGrants)
    }

    // ── Skills ───────────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        val page: Page<Map<String, Any?>> = repo
            .list(ctx.workspaceId, ctx.environmentId, req.query("status"), req.pageParams())
            .let { Page(it.items.map { s -> s.toResponse() }, it.total, it.page, it.pageSize) }
        return Response.ok(page)
    }

    private fun create(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val body = req.bodyAs<CreateSkillBody>()

        val rawName = requireMaxLength(requireField(body.name, "name"), "name", 255)
        val rawInstructions = requireField(body.instructions, "instructions")

        /*
         * ── SANITIZED HERE, AT THE WRITE BOUNDARY (INVARIANT 4) ─────────────
         * Not in the repository, and emphatically not at composition time. A
         * sanitizer that runs when the text is RENDERED has to run everywhere the
         * text can reach — the prompt, this response, a version diff, a span —
         * and the one place somebody forgets is the one that matters.
         */
        val name = SkillSanitizer.name(rawName)
            ?: throw ApiError.ValidationError("name must contain readable text")
        val instructions = SkillSanitizer.text(rawInstructions)
            ?: throw ApiError.ValidationError("instructions must contain readable text")

        val skill = repo.create(
            workspaceId = ctx.workspaceId,
            environmentId = envId,
            name = name,
            slug = slugify(body.slug?.takeIf { it.isNotBlank() } ?: name),
            description = SkillSanitizer.text(body.description, SkillSanitizer.MAX_SUMMARY_CHARS),
            /*
             * ── A CUSTOMER CANNOT WRITE `first_party` ───────────────────────
             * There is no field for it on the request and no branch that reads
             * one. The only way a skill becomes first-party is being installed
             * from the catalogue, which is a table with no workspace column that
             * nothing outside a migration writes. A provenance marker that a
             * customer could set would be a badge with nothing behind it.
             */
            provenance = "customer",
            catalogEntryId = null,
            definition = versionInput(
                name = name,
                summary = body.summary,
                instructions = instructions,
                rawInstructions = rawInstructions,
                outputContract = body.outputContract,
                examples = body.examples,
                requiredTools = body.requiredTools,
                workspaceId = ctx.workspaceId,
                changeSummary = "Created",
            ),
            createdBy = req.principal?.appUserId,
        )
        return Response.created(mapOf(
            "skill" to skill.first.toResponse(),
            "version" to skill.second.toResponse(),
        ))
    }

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val skill = repo.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Skill")
        val versions = repo.listVersions(skill.id, ctx.workspaceId)
        return Response.ok(mapOf(
            "skill" to skill.toResponse(),
            "currentVersion" to versions.firstOrNull { it.id == skill.currentVersionId }?.toResponse(),
            "versionCount" to versions.size,
        ))
    }

    private fun listVersions(req: Request): Response {
        val ctx = req.context()
        val skill = repo.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Skill")
        return Response.ok(mapOf("versions" to repo.listVersions(skill.id, ctx.workspaceId).map { it.toResponse() }))
    }

    private fun addVersion(req: Request): Response {
        val ctx = req.context()
        val skill = repo.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Skill")
        val body = req.bodyAs<NewVersionBody>()
        val rawInstructions = requireField(body.instructions, "instructions")
        val instructions = SkillSanitizer.text(rawInstructions)
            ?: throw ApiError.ValidationError("instructions must contain readable text")
        val name = SkillSanitizer.name(body.name ?: skill.name) ?: skill.name

        val version = repo.addVersion(
            skillId = skill.id,
            workspaceId = ctx.workspaceId,
            definition = versionInput(
                name = name,
                summary = body.summary,
                instructions = instructions,
                rawInstructions = rawInstructions,
                outputContract = body.outputContract,
                examples = body.examples,
                requiredTools = body.requiredTools,
                workspaceId = ctx.workspaceId,
                changeSummary = body.changeSummary,
            ),
            createdBy = req.principal?.appUserId,
        )

        /*
         * ── WHO THIS AFFECTS, SAID OUT LOUD ─────────────────────────────────
         * An unpinned grant follows `current_version_id`, so writing a version
         * changes the behaviour of every agent holding this skill on its next
         * activation. That is the intended and useful default — fix the wording
         * once, every agent improves — and it is also the kind of blast radius an
         * author should be told about rather than discover from a run.
         *
         * Returned rather than refused: it is their skill and their agents.
         */
        val holders = repo.agentsHolding(skill.id, ctx.workspaceId)
        return Response.created(mapOf(
            "version" to version.toResponse(),
            "affectedAgents" to holders.map { mapOf("id" to it.first.toString(), "name" to it.second) },
        ))
    }

    private fun archive(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Skill")
        /*
         * ── ARCHIVED, NOT DELETED, AND THE GRANTS SURVIVE ───────────────────
         * The same call `McpDiscovery` makes about a withdrawn tool: the loader
         * filters on `status = 'active'`, so an archived skill stops composing
         * immediately, and the grant rows stay. Deleting would silently shrink
         * every holding agent's configuration with no record that it happened,
         * and un-archiving would then be a re-grant somebody has to reconstruct.
         */
        repo.archive(id, ctx.workspaceId)
        return Response.noContent()
    }

    private fun listHolders(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Skill")
        return Response.ok(mapOf("agents" to repo.agentsHolding(id, ctx.workspaceId)
            .map { mapOf("id" to it.first.toString(), "name" to it.second) }))
    }

    // ── The library ──────────────────────────────────────────────────────────

    private fun listCatalog(req: Request): Response =
        Response.ok(mapOf("entries" to repo.listCatalog().map { it.toResponse() }))

    /**
     * Install a catalogue entry into this workspace, binding its capabilities.
     *
     * ── THE BINDING STEP IS THE PRODUCT, NOT A FORMALITY ────────────────────
     * A first-party skill has no workspace and therefore cannot name a tool
     * uuid; it declares capabilities. Installing is where an operator sees
     * exactly which of THEIR tools a platform skill is about to start
     * instructing their agents to call. A library that installed itself silently
     * would be us adding instructions to somebody else's production agent.
     *
     * Every declared capability must be bound. A partial install would create a
     * skill whose required-tools list is incomplete, and an incomplete
     * requirement list makes the grant check pass for an agent that will fail at
     * iteration four — which is the exact failure this whole feature removes.
     */
    private fun install(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val body = req.bodyAs<InstallBody>()
        val slug = req.pathParam("slug")

        val entry = repo.findCatalogEntry(slug, body.version)
            ?: throw ApiError.NotFound("Skill '$slug' in the library")

        val bindings = body.toolBindings ?: emptyMap()
        val required = mutableListOf<ToolRequirement>()
        val unbound = mutableListOf<String>()
        for (cap in entry.requiredCapabilities) {
            val raw = bindings[cap.key]
            val toolId = raw?.let { runCatching { UUID.fromString(it) }.getOrNull() }
            if (toolId == null) { unbound += cap.label; continue }
            /* Workspace-scoped, and fails closed on a miss: a binding naming a
               tool from another workspace must read as "not bound", never as
               "bound to something you cannot see" (invariant 8). */
            val tool = toolRepo.findById(toolId, ctx.workspaceId)
            if (tool == null) { unbound += cap.label; continue }
            required += ToolRequirement(toolId, cap.label)
        }
        if (unbound.isNotEmpty()) {
            throw ApiError.UnprocessableEntity(
                "This skill needs a tool for ${unbound.joinToString(", ")}. " +
                "Pick one of your tools for each, then install it."
            )
        }

        val name = SkillSanitizer.name(entry.name) ?: entry.name
        val existing = repo.findBySlug(entry.slug, ctx.workspaceId, envId)
        if (existing != null) {
            /* Re-installing is an UPGRADE, not a duplicate. A second skill with
               the same text and a different id would silently split every grant
               in the workspace across two rows. */
            val version = repo.addVersion(
                skillId = existing.id,
                workspaceId = ctx.workspaceId,
                definition = SkillRepository.VersionInput(
                    name = name,
                    summary = SkillSanitizer.text(entry.summary, SkillSanitizer.MAX_SUMMARY_CHARS),
                    instructions = SkillSanitizer.text(entry.instructions) ?: entry.instructions,
                    outputContract = SkillSanitizer.text(entry.outputContract, SkillSanitizer.MAX_CONTRACT_CHARS),
                    examples = SkillSanitizer.examples(entry.examples),
                    requiredTools = required,
                    flaggedForReview = false,
                    changeSummary = "Installed ${entry.slug} v${entry.version} from the library",
                ),
                createdBy = req.principal?.appUserId,
            )
            return Response.ok(mapOf(
                "skill" to repo.findById(existing.id, ctx.workspaceId)!!.toResponse(),
                "version" to version.toResponse(),
                "upgraded" to true,
            ))
        }

        val (skill, version) = repo.create(
            workspaceId = ctx.workspaceId,
            environmentId = envId,
            name = name,
            slug = entry.slug,
            description = entry.summary,
            provenance = "first_party",
            catalogEntryId = entry.id,
            definition = SkillRepository.VersionInput(
                name = name,
                summary = SkillSanitizer.text(entry.summary, SkillSanitizer.MAX_SUMMARY_CHARS),
                instructions = SkillSanitizer.text(entry.instructions) ?: entry.instructions,
                outputContract = SkillSanitizer.text(entry.outputContract, SkillSanitizer.MAX_CONTRACT_CHARS),
                examples = SkillSanitizer.examples(entry.examples),
                requiredTools = required,
                flaggedForReview = false,
                changeSummary = "Installed ${entry.slug} v${entry.version} from the library",
            ),
            createdBy = req.principal?.appUserId,
        )
        return Response.created(mapOf(
            "skill" to skill.toResponse(),
            "version" to version.toResponse(),
            "upgraded" to false,
        ))
    }

    // ── The grant ────────────────────────────────────────────────────────────

    private fun listGrants(req: Request): Response {
        val ctx = req.context()
        val agentId = req.pathUUID("id")
        agentRepo.findById(agentId, ctx.workspaceId) ?: throw ApiError.NotFound("Agent")
        val granted = repo.loadGrantedSkills(agentId, ctx.workspaceId)
        val grants = repo.listGrants(agentId, ctx.workspaceId).associateBy { it.skillId }
        return Response.ok(mapOf(
            "skills" to granted.map { s ->
                mapOf(
                    "skillId" to s.skillId.toString(),
                    "name" to s.name,
                    "slug" to s.slug,
                    "version" to s.version,
                    "pinned" to (grants[s.skillId]?.skillVersionId != null),
                    "provenance" to s.provenance.name.lowercase(),
                    "requiredTools" to s.requiredTools.map {
                        mapOf("toolId" to it.toolId.toString(), "label" to it.label)
                    },
                )
            },
            /* What the agent's prompt will actually carry, computed by the same
               composer the worker runs. A preview, not a promise about the
               future: a tool revoked tomorrow changes it, which is why the
               runtime re-checks. */
            "composition" to compositionPreview(granted),
        ))
    }

    /**
     * Replace an agent's skills — and refuse the grant that cannot work.
     *
     * Two refusals, in this order:
     *
     *  1. **Missing tools.** The acceptance criterion. Named, all of them, with
     *     the labels the skill author gave them.
     *  2. **Does not fit.** Three skills that together exceed the prompt budget
     *     is a DESIGN-TIME error: the author is told now, by the same composer
     *     the worker will run, rather than discovering at 3am that the third
     *     skill was silently cut in half.
     *
     * Both are 422 rather than 400: the request is well formed and every id in
     * it exists. What is wrong is the combination.
     */
    private fun setGrants(req: Request): Response {
        val ctx = req.context()
        val agentId = req.pathUUID("id")
        val agent = agentRepo.findById(agentId, ctx.workspaceId) ?: throw ApiError.NotFound("Agent")
        val body = req.bodyAs<SetGrantsBody>()
        val requested = body.skills ?: emptyList()

        val skillIds = requested.map { g ->
            val raw = requireField(g.skillId, "skills[].skillId")
            runCatching { UUID.fromString(raw) }.getOrElse {
                throw ApiError.ValidationError("skillId '$raw' is not a valid UUID")
            }
        }
        if (skillIds.size != skillIds.toSet().size) {
            throw ApiError.ValidationError("The same skill appears twice in this grant")
        }

        val skills = repo.loadForComposition(skillIds, ctx.workspaceId)
        if (skills.size != skillIds.size) {
            /* A skill id that is not in this workspace reads as "not found", never
               as "belongs to somebody else" — the cross-workspace answer must be
               indistinguishable from the does-not-exist one (invariant 8). */
            val found = skills.map { it.skillId }.toSet()
            val missing = skillIds.filterNot { it in found }
            throw ApiError.ValidationError(
                "These skills are not available in this workspace: ${missing.joinToString(", ")}"
            )
        }

        // ── 1. The tools the skills need ─────────────────────────────────────
        val grantedToolIds = agent.allowedToolIds
            .mapNotNull { runCatching { UUID.fromString(it) }.getOrNull() }
            .toSet()
        val missing = SkillGrant.check(skills, grantedToolIds)
        if (missing.isNotEmpty()) {
            log.info(
                "[skills] grant refused agent={} missingTools={}",
                agentId, missing.sumOf { it.tools.size },
            )
            throw ApiError.SkillToolsMissing(
                SkillGrant.explain(missing), SkillGrant.details(missing),
            )
        }

        // ── 2. Whether they fit in one prompt together ───────────────────────
        SkillComposer.wouldNotFit(skills, SkillComposer.budgetFor(contextCharBudget()))
            ?.let { throw ApiError.UnprocessableEntity(it) }

        repo.replaceGrants(
            agentId = agentId,
            workspaceId = ctx.workspaceId,
            grants = requested.mapIndexed { i, g ->
                SkillGrantRow(
                    skillId = skillIds[i],
                    skillVersionId = g.skillVersionId?.let {
                        runCatching { UUID.fromString(it) }.getOrNull()
                    },
                    position = i,
                )
            },
            grantedBy = req.principal?.appUserId,
        )
        return Response.ok(mapOf(
            "agentId" to agentId.toString(),
            "skills" to skills.map {
                mapOf("skillId" to it.skillId.toString(), "slug" to it.slug, "version" to it.version)
            },
            "composition" to compositionPreview(skills),
        ))
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun compositionPreview(skills: List<Skill>): Map<String, Any?> {
        val composed = SkillComposer.compose(skills, SkillComposer.budgetFor(contextCharBudget()))
        return mapOf(
            "chars" to composed.charsUsed,
            "charBudget" to composed.charBudget,
            "degraded" to composed.degraded,
        )
    }

    /**
     * The context budget this deployment runs at.
     *
     * Read from the same environment variable the worker reads, so the save-time
     * preview is computed against the number the runtime will actually use. A
     * hard-coded default here would make the warning right on one deployment and
     * wrong on every other.
     */
    private fun contextCharBudget(): Int =
        System.getenv("AGENT_CONTEXT_CHAR_BUDGET")?.toIntOrNull()?.coerceAtLeast(1_000) ?: 48_000

    private fun versionInput(
        name: String,
        summary: String?,
        instructions: String,
        rawInstructions: String,
        outputContract: String?,
        examples: List<ExampleBody>?,
        requiredTools: List<RequiredToolBody>?,
        workspaceId: UUID,
        changeSummary: String?,
    ): SkillRepository.VersionInput {
        val tools = (requiredTools ?: emptyList()).map { t ->
            val raw = requireField(t.toolId, "requiredTools[].toolId")
            val id = runCatching { UUID.fromString(raw) }.getOrElse {
                throw ApiError.ValidationError("requiredTools[].toolId '$raw' is not a valid UUID")
            }
            /*
             * The tool must exist HERE. A requirement naming a tool the workspace
             * does not have could never be satisfied by any grant, so the skill
             * would be permanently ungrantable — refused at save with a message
             * about a tool nobody can see. Better to refuse the requirement.
             */
            val tool = toolRepo.findById(id, workspaceId)
                ?: throw ApiError.ValidationError(
                    "requiredTools names a tool that is not in this workspace: $raw"
                )
            ToolRequirement(id, SkillSanitizer.name(t.label ?: tool.name) ?: tool.name)
        }
        return SkillRepository.VersionInput(
            name = name,
            summary = SkillSanitizer.text(summary, SkillSanitizer.MAX_SUMMARY_CHARS),
            instructions = instructions,
            outputContract = SkillSanitizer.text(outputContract, SkillSanitizer.MAX_CONTRACT_CHARS),
            examples = SkillSanitizer.examples(
                (examples ?: emptyList()).mapNotNull { e ->
                    val t = e.title; val b = e.body
                    if (t.isNullOrBlank() || b.isNullOrBlank()) null else SkillExample(t, b)
                }
            ),
            requiredTools = tools,
            /* Flagged on the RAW text, before cleaning. Asking whether the stored
               text looks like injection would always answer no — we just removed
               the evidence. */
            flaggedForReview = SkillSanitizer.looksLikeInjection(rawInstructions),
            changeSummary = changeSummary,
        )
    }
}
