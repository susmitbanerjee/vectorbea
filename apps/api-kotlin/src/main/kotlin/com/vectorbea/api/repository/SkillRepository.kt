package com.vectorbea.api.repository

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import com.vectorbea.api.db.setJsonb
import com.vectorbea.skills.Skill
import com.vectorbea.skills.SkillExample
import com.vectorbea.skills.ToolRequirement
import org.slf4j.LoggerFactory
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/** A skill row, with the version that is live for it. */
data class SkillRow(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val provenance: String,
    val catalogEntryId: UUID?,
    val currentVersionId: UUID?,
    val currentVersion: Int,
    val status: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

/** One immutable definition of a skill. */
data class SkillVersionRow(
    val id: UUID,
    val skillId: UUID,
    val version: Int,
    val name: String,
    val summary: String?,
    val instructions: String,
    val outputContract: String?,
    val examples: List<SkillExample>,
    val requiredTools: List<ToolRequirement>,
    val flaggedForReview: Boolean,
    val changeSummary: String?,
    val createdAt: Instant,
    val createdBy: UUID?,
)

/** One grant, as stored. */
data class SkillGrantRow(
    val skillId: UUID,
    /** Null follows `skills.current_version_id`; non-null pins. */
    val skillVersionId: UUID?,
    val position: Int,
)

/** A library entry, before anyone has bound its capabilities to real tools. */
data class SkillCatalogRow(
    val id: UUID,
    val slug: String,
    val version: Int,
    val name: String,
    val summary: String?,
    val category: String?,
    val instructions: String,
    val outputContract: String?,
    val examples: List<SkillExample>,
    val requiredCapabilities: List<Capability>,
    val status: String,
) {
    data class Capability(val key: String, val label: String, val why: String?)
}

/**
 * Skills, their versions, their grants, and the curated library.
 *
 * ── EVERY READ IS WORKSPACE-SCOPED, INCLUDING THE ONES THAT LOOK INTERNAL ──
 * Invariant 8. [loadGrantedSkills] takes a workspace even though `agent_skills`
 * is keyed on an agent and an agent belongs to exactly one workspace, because
 * "belongs to exactly one workspace" is a fact about data that a bug can make
 * untrue, and the join is free. The catalogue is the single exception and is
 * workspace-LESS by construction rather than by omission: it has no such column
 * to filter on, which is what makes a first-party skill first-party.
 */
class SkillRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(SkillRepository::class.java)

    private val mapper = jacksonObjectMapper()

    private val skillCols = """
        id, workspace_id, environment_id, name, slug, description, provenance,
        catalog_entry_id, current_version_id, current_version, status, created_at, updated_at
    """.trimIndent()

    private val versionCols = """
        id, skill_id, version, name, summary, instructions, output_contract,
        examples_json, required_tools_json, flagged_for_review, change_summary,
        created_at, created_by
    """.trimIndent()

    /**
     * The same columns, qualified, for the reads that JOIN `skills`.
     *
     * Spelled out rather than derived from [versionCols] by string surgery: the
     * bug this replaces was writing `v.$versionCols`, which qualifies the FIRST
     * column and leaves every other one bare — so `name`, `version` and
     * `skill_id` all became ambiguous against the joined table, and the query
     * failed at run time with a message that names a column rather than the
     * splice that produced it.
     */
    private val versionColsQualified = """
        v.id AS version_id, v.version, v.name, v.summary, v.instructions,
        v.output_contract, v.examples_json, v.required_tools_json
    """.trimIndent()

    // ── Skills ───────────────────────────────────────────────────────────────

    fun list(
        workspaceId: UUID,
        environmentId: UUID?,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<SkillRow> {
        val filters = buildList {
            add("workspace_id = ?")
            if (environmentId != null) add("environment_id = ?")
            if (status != null) add("status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bind: java.sql.PreparedStatement.() -> Unit = {
            var i = 1
            setUuid(i++, workspaceId)
            if (environmentId != null) setUuid(i++, environmentId)
            if (status != null) setString(i++, status)
        }
        return queryPage(
            sql = "SELECT $skillCols FROM skills $where ORDER BY name",
            countSql = "SELECT COUNT(*) FROM skills $where",
            params = params,
            bind = bind,
            mapRow = ::mapSkill,
        )
    }

    fun findById(id: UUID, workspaceId: UUID): SkillRow? = queryOne(
        "SELECT $skillCols FROM skills WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapSkill,
    )

    fun findBySlug(slug: String, workspaceId: UUID, environmentId: UUID): SkillRow? = queryOne(
        "SELECT $skillCols FROM skills WHERE slug = ? AND workspace_id = ? AND environment_id = ?",
        { setString(1, slug); setUuid(2, workspaceId); setUuid(3, environmentId) },
        ::mapSkill,
    )

    /**
     * Create a skill and its first version, in one transaction.
     *
     * One transaction because a skill with no version is not a partial skill, it
     * is an unusable row that every reader has to special-case forever. The FK on
     * `current_version_id` is DEFERRABLE for exactly this: the skill is inserted
     * first so the version can reference it, and the pointer back is set before
     * the commit checks it.
     */
    fun create(
        workspaceId: UUID,
        environmentId: UUID,
        name: String,
        slug: String,
        description: String?,
        provenance: String,
        catalogEntryId: UUID?,
        definition: VersionInput,
        createdBy: UUID?,
    ): Pair<SkillRow, SkillVersionRow> = dataSource.connection.use { conn ->
        conn.autoCommit = false
        try {
            val skillId = conn.prepareStatement(
                """INSERT INTO skills
                     (workspace_id, environment_id, name, slug, description, provenance,
                      catalog_entry_id, current_version, status, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?)
                   RETURNING id"""
            ).use { st ->
                st.setObject(1, workspaceId); st.setObject(2, environmentId)
                st.setString(3, name); st.setString(4, slug); st.setString(5, description)
                st.setString(6, provenance)
                if (catalogEntryId != null) st.setObject(7, catalogEntryId)
                else st.setNull(7, java.sql.Types.OTHER)
                if (createdBy != null) st.setObject(8, createdBy) else st.setNull(8, java.sql.Types.OTHER)
                st.executeQuery().use { rs -> rs.next(); UUID.fromString(rs.getString(1)) }
            }
            val version = insertVersion(conn, skillId, workspaceId, 1, definition, createdBy)
            conn.prepareStatement("UPDATE skills SET current_version_id = ? WHERE id = ?").use { st ->
                st.setObject(1, version.id); st.setObject(2, skillId); st.executeUpdate()
            }
            conn.commit()
            val row = findById(skillId, workspaceId)!!
            row to version
        } catch (e: Exception) {
            runCatching { conn.rollback() }
            throw e
        } finally {
            runCatching { conn.autoCommit = true }
        }
    }

    /**
     * Write a new version and make it current.
     *
     * ── NEVER AN IN-PLACE EDIT ──────────────────────────────────────────────
     * `ToolVersionRepository` makes the same call for the same reason: a
     * definition that changes under a grant is a grant to something nobody
     * reviewed. The consequence differs in kind — a widened tool spends money, a
     * rewritten skill changes behaviour — but the diagnostic problem is
     * identical, and "the agent behaved differently on Tuesday and nothing about
     * the agent changed" is unanswerable without this row.
     *
     * Agents that PINNED the old version keep running it; agents that follow pick
     * the new one up on their next activation. Both are recorded per activation,
     * so either way the question stays answerable.
     */
    fun addVersion(
        skillId: UUID,
        workspaceId: UUID,
        definition: VersionInput,
        createdBy: UUID?,
    ): SkillVersionRow = dataSource.connection.use { conn ->
        conn.autoCommit = false
        try {
            val next = conn.prepareStatement(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM skill_versions WHERE skill_id = ?"
            ).use { st ->
                st.setObject(1, skillId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
            val version = insertVersion(conn, skillId, workspaceId, next, definition, createdBy)
            conn.prepareStatement(
                """UPDATE skills
                      SET current_version_id = ?, current_version = ?, name = ?, updated_at = now()
                    WHERE id = ? AND workspace_id = ?"""
            ).use { st ->
                st.setObject(1, version.id); st.setInt(2, next)
                st.setString(3, definition.name)
                st.setObject(4, skillId); st.setObject(5, workspaceId)
                st.executeUpdate()
            }
            conn.commit()
            version
        } catch (e: Exception) {
            runCatching { conn.rollback() }
            throw e
        } finally {
            runCatching { conn.autoCommit = true }
        }
    }

    fun listVersions(skillId: UUID, workspaceId: UUID): List<SkillVersionRow> = query(
        "SELECT $versionCols FROM skill_versions WHERE skill_id = ? AND workspace_id = ? ORDER BY version DESC",
        { setUuid(1, skillId); setUuid(2, workspaceId) },
        ::mapVersion,
    )

    fun archive(id: UUID, workspaceId: UUID): Int = execute(
        "UPDATE skills SET status = 'archived', updated_at = now() WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
    )

    // ── The composable form ──────────────────────────────────────────────────

    /**
     * The skills [skillIds] resolve to, at their CURRENT version.
     *
     * What the save-time check runs against. A grant being validated has not been
     * written yet, so there is nothing to read from `agent_skills` — the request
     * names the ids and this turns them into the things the composer will see.
     *
     * Silently returns fewer than asked for when an id is not in the workspace.
     * The caller compares counts and refuses; returning a partial list with no
     * error would let a cross-workspace id vanish quietly, which is the shape of
     * an isolation bug rather than a validation one.
     */
    fun loadForComposition(skillIds: Collection<UUID>, workspaceId: UUID): List<Skill> {
        if (skillIds.isEmpty()) return emptyList()
        val placeholders = skillIds.joinToString(",") { "?" }
        val byId = query(
            """SELECT s.id AS skill_id, s.slug, s.provenance, $versionColsQualified
                 FROM skills s
                 JOIN skill_versions v ON v.id = s.current_version_id
                WHERE s.id IN ($placeholders) AND s.workspace_id = ? AND s.status = 'active'""",
            {
                skillIds.forEachIndexed { i, id -> setUuid(i + 1, id) }
                setUuid(skillIds.size + 1, workspaceId)
            },
            ::mapComposable,
        ).associateBy { it.skillId }
        /* Caller order preserved: the request's order IS the composition order,
           and returning database order would silently reorder a pipeline. */
        return skillIds.mapNotNull { byId[it] }
    }

    /**
     * What this agent actually holds, in composition order, at the version each
     * grant resolves to.
     *
     * This is the read the worker's loader performs, expressed once here so the
     * API's "what will this agent see" preview and the runtime's composition
     * cannot disagree. A pinned grant reads its pinned version; an unpinned one
     * follows `current_version_id`.
     */
    fun loadGrantedSkills(agentId: UUID, workspaceId: UUID): List<Skill> = query(
        """SELECT s.id AS skill_id, s.slug, s.provenance, $versionColsQualified
             FROM agent_skills g
             JOIN skills s ON s.id = g.skill_id AND s.workspace_id = g.workspace_id
             JOIN skill_versions v ON v.id = COALESCE(g.skill_version_id, s.current_version_id)
            WHERE g.agent_id = ? AND g.workspace_id = ? AND s.status = 'active'
            ORDER BY g.position, s.name""",
        { setUuid(1, agentId); setUuid(2, workspaceId) },
        ::mapComposable,
    )

    // ── Grants ───────────────────────────────────────────────────────────────

    fun listGrants(agentId: UUID, workspaceId: UUID): List<SkillGrantRow> = query(
        """SELECT skill_id, skill_version_id, position
             FROM agent_skills WHERE agent_id = ? AND workspace_id = ?
            ORDER BY position""",
        { setUuid(1, agentId); setUuid(2, workspaceId) },
        { rs ->
            SkillGrantRow(
                skillId = rs.uuid("skill_id"),
                skillVersionId = rs.uuidOrNull("skill_version_id"),
                position = rs.getInt("position"),
            )
        },
    )

    /**
     * Replace an agent's grants with [grants], in the order given.
     *
     * A REPLACE rather than a merge: the form sends the whole list, and a merge
     * would make "remove this skill" an operation the API does not have. The
     * position is the index in the list, which is what makes drag-to-reorder in
     * the form mean something at run time.
     *
     * Transactional, because an agent that briefly holds half a grant set is an
     * agent whose next activation composes half a pipeline.
     */
    fun replaceGrants(
        agentId: UUID,
        workspaceId: UUID,
        grants: List<SkillGrantRow>,
        grantedBy: UUID?,
    ): Unit = dataSource.connection.use { conn ->
        conn.autoCommit = false
        try {
            conn.prepareStatement("DELETE FROM agent_skills WHERE agent_id = ? AND workspace_id = ?").use { st ->
                st.setObject(1, agentId); st.setObject(2, workspaceId); st.executeUpdate()
            }
            if (grants.isNotEmpty()) {
                conn.prepareStatement(
                    """INSERT INTO agent_skills
                         (agent_id, skill_id, workspace_id, skill_version_id, position, granted_by)
                       VALUES (?, ?, ?, ?, ?, ?)"""
                ).use { st ->
                    grants.forEachIndexed { i, g ->
                        st.setObject(1, agentId); st.setObject(2, g.skillId)
                        st.setObject(3, workspaceId)
                        if (g.skillVersionId != null) st.setObject(4, g.skillVersionId)
                        else st.setNull(4, java.sql.Types.OTHER)
                        st.setInt(5, i)
                        if (grantedBy != null) st.setObject(6, grantedBy) else st.setNull(6, java.sql.Types.OTHER)
                        st.addBatch()
                    }
                    st.executeBatch()
                }
            }
            conn.commit()
        } catch (e: Exception) {
            runCatching { conn.rollback() }
            throw e
        } finally {
            runCatching { conn.autoCommit = true }
        }
    }

    /** Which agents hold this skill — what a "you are about to change 6 agents" warning reads. */
    fun agentsHolding(skillId: UUID, workspaceId: UUID): List<Pair<UUID, String>> = query(
        """SELECT a.id, a.name FROM agent_skills g
             JOIN agents a ON a.id = g.agent_id
            WHERE g.skill_id = ? AND g.workspace_id = ? ORDER BY a.name""",
        { setUuid(1, skillId); setUuid(2, workspaceId) },
        { rs -> rs.uuid("id") to rs.getString("name") },
    )

    // ── The library ──────────────────────────────────────────────────────────

    /** Latest version of each active catalogue entry. */
    fun listCatalog(): List<SkillCatalogRow> = query(
        """SELECT DISTINCT ON (slug)
                  id, slug, version, name, summary, category, instructions,
                  output_contract, examples_json, required_capabilities_json, status
             FROM skill_catalog_entries
            WHERE status = 'active'
            ORDER BY slug, version DESC""",
        {},
        ::mapCatalog,
    )

    fun findCatalogEntry(slug: String, version: Int? = null): SkillCatalogRow? = queryOne(
        """SELECT id, slug, version, name, summary, category, instructions,
                  output_contract, examples_json, required_capabilities_json, status
             FROM skill_catalog_entries
            WHERE slug = ? AND (CAST(? AS INTEGER) IS NULL OR version = CAST(? AS INTEGER))
            ORDER BY version DESC LIMIT 1""",
        {
            setString(1, slug)
            if (version != null) { setInt(2, version); setInt(3, version) }
            else { setNull(2, java.sql.Types.INTEGER); setNull(3, java.sql.Types.INTEGER) }
        },
        ::mapCatalog,
    )

    // ── Input ────────────────────────────────────────────────────────────────

    /**
     * One version's content, already sanitized by the route.
     *
     * Sanitized BEFORE it gets here, deliberately: invariant 4 says the stores
     * keep what they are given, and a repository that sanitized would be a second
     * place the rule lives — which is how one of them ends up not doing it.
     */
    data class VersionInput(
        val name: String,
        val summary: String?,
        val instructions: String,
        val outputContract: String?,
        val examples: List<SkillExample>,
        val requiredTools: List<ToolRequirement>,
        val flaggedForReview: Boolean,
        val changeSummary: String?,
    )

    private fun insertVersion(
        conn: java.sql.Connection,
        skillId: UUID,
        workspaceId: UUID,
        version: Int,
        def: VersionInput,
        createdBy: UUID?,
    ): SkillVersionRow = conn.prepareStatement(
        """INSERT INTO skill_versions
             (skill_id, workspace_id, version, name, summary, instructions, output_contract,
              examples_json, required_tools_json, flagged_for_review, change_summary, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING $versionCols"""
    ).use { st ->
        st.setObject(1, skillId); st.setObject(2, workspaceId); st.setInt(3, version)
        st.setString(4, def.name); st.setString(5, def.summary)
        st.setString(6, def.instructions); st.setString(7, def.outputContract)
        st.setJsonb(8, def.examples.map { mapOf("title" to it.title, "body" to it.body) })
        st.setJsonb(9, def.requiredTools.map {
            mapOf("toolId" to it.toolId.toString(), "label" to it.label)
        })
        st.setBoolean(10, def.flaggedForReview)
        st.setString(11, def.changeSummary)
        if (createdBy != null) st.setObject(12, createdBy) else st.setNull(12, java.sql.Types.OTHER)
        st.executeQuery().use { rs -> rs.next(); mapVersion(rs) }
    }

    // ── Mapping ──────────────────────────────────────────────────────────────

    private fun mapSkill(rs: ResultSet) = SkillRow(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        description = rs.getString("description"),
        provenance = rs.getString("provenance"),
        catalogEntryId = rs.uuidOrNull("catalog_entry_id"),
        currentVersionId = rs.uuidOrNull("current_version_id"),
        currentVersion = rs.getInt("current_version"),
        status = rs.getString("status"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )

    private fun mapVersion(rs: ResultSet) = SkillVersionRow(
        id = rs.uuid("id"),
        skillId = rs.uuid("skill_id"),
        version = rs.getInt("version"),
        name = rs.getString("name"),
        summary = rs.getString("summary"),
        instructions = rs.getString("instructions"),
        outputContract = rs.getString("output_contract"),
        examples = parseExamples(rs.getString("examples_json")),
        requiredTools = parseRequiredTools(rs.getString("required_tools_json")),
        flaggedForReview = rs.getBoolean("flagged_for_review"),
        changeSummary = rs.getString("change_summary"),
        createdAt = rs.instant("created_at"),
        createdBy = rs.uuidOrNull("created_by"),
    )

    private fun mapComposable(rs: ResultSet) = Skill(
        skillId = rs.uuid("skill_id"),
        versionId = rs.uuid("version_id"),
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

    private fun mapCatalog(rs: ResultSet) = SkillCatalogRow(
        id = rs.uuid("id"),
        slug = rs.getString("slug"),
        version = rs.getInt("version"),
        name = rs.getString("name"),
        summary = rs.getString("summary"),
        category = rs.getString("category"),
        instructions = rs.getString("instructions"),
        outputContract = rs.getString("output_contract"),
        examples = parseExamples(rs.getString("examples_json")),
        requiredCapabilities = parseCapabilities(rs.getString("required_capabilities_json")),
        status = rs.getString("status"),
    )

    /*
     * ── A MALFORMED JSONB COLUMN YIELDS NOTHING, NOT AN EXCEPTION ───────────
     * These columns are written by this service and are well formed in every
     * path that exists. Parsing defensively anyway because the alternative is a
     * skill list endpoint that 500s for a whole workspace because one row is
     * odd — and because a skill with no examples is a usable skill, while a
     * skills page that will not load is not.
     *
     * A required-tools list that fails to parse is the one case worth noting:
     * it yields EMPTY, which makes the grant check pass vacuously. That is safe
     * only because the check is a usability guard and never a permission — the
     * tool grant itself is still enforced by `validateToolAllowed` against
     * `allowed_tool_ids`, which does not read this column or any other JSON.
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

    private fun parseCapabilities(raw: String?): List<SkillCatalogRow.Capability> = runCatching {
        mapper.readValue<List<Map<String, String?>>>(raw ?: "[]").mapNotNull {
            val key = it["key"]; val label = it["label"]
            if (key != null && label != null) SkillCatalogRow.Capability(key, label, it["why"]) else null
        }
    }.getOrElse { emptyList() }
}
