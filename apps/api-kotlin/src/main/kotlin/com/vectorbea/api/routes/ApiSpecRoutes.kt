package com.vectorbea.api.routes

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.api.slugify
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.openapi.OpenApiDocument
import com.vectorbea.api.openapi.OpenApiReader
import com.vectorbea.api.openapi.OperationMapper
import com.vectorbea.api.openapi.PostmanConverter
import com.vectorbea.api.openapi.SecuritySchemeMapper
import com.vectorbea.api.openapi.SpecDiff
import com.vectorbea.api.openapi.SpecSecretScan
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.CreateSpecImport
import com.vectorbea.api.repository.CreateToolRequest
import com.vectorbea.api.repository.CreateToolVersion
import com.vectorbea.api.repository.SpecImport
import com.vectorbea.api.repository.SpecImportRepository
import com.vectorbea.api.repository.SpecOperationDraft
import com.vectorbea.api.repository.ToolRepository
import com.vectorbea.api.repository.ToolVersionRepository
import com.vectorbea.api.db.withConnection
import com.vectorbea.api.security.SsrfGuard
import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import javax.sql.DataSource

/**
 * Import an API document; turn its operations into tools; diff a re-import.
 *
 * ── THE FLOW, AND WHY IT IS THREE STEPS RATHER THAN ONE ─────────────────────
 *   1. IMPORT   — fetch or accept the document, parse it, list its operations,
 *                 and say which credential it needs. Creates NO tools.
 *   2. SELECT   — the person picks the operations they want. Those become tools.
 *   3. RE-IMPORT — the same document, later. Produces a DIFF, and never a
 *                 mutation.
 *
 * Step 1 creating nothing is deliberate. A customer importing GitHub is looking
 * at nine hundred operations and wants four; an import that created nine hundred
 * tools would have made the tool registry unusable in one click, and there is no
 * undo that puts that right.
 *
 * ── ITEM 12 IS ENFORCED HERE AND IN ONE OTHER PLACE ─────────────────────────
 * "Never silently changes a tool an agent is already granted." The rule this
 * code implements is stronger and simpler: a re-import never changes a tool at
 * all. It writes `tool_versions` rows in `review_state = 'pending'`, and the
 * only thing that makes one live is [ToolVersionRoutes.apply], which a person
 * calls. A rule with an exception for "not granted" would be a rule somebody's
 * edge case walks through — and the grant can be added a minute after the
 * import.
 */
class ApiSpecRoutes(
    private val imports: SpecImportRepository,
    private val tools: ToolRepository,
    private val versions: ToolVersionRepository,
    private val connections: ConnectionRepository,
    private val dataSource: DataSource,
) {

    fun register(router: Router) {
        router.post("/api/tool-specs/import", ::import)
        router.get("/api/tool-specs", ::list)
        router.get("/api/tool-specs/:id", ::detail)
        router.get("/api/tool-specs/:id/operations", ::operations)
        router.get("/api/tool-specs/:id/diff", ::diff)
        router.post("/api/tool-specs/:id/tools", ::createTools)
        router.patch("/api/tool-specs/:id", ::update)
    }

    // ── Import ───────────────────────────────────────────────────────────────

    private data class ImportBody(
        val name: String? = null,
        /** Fetch from here. Mutually exclusive with [document]. */
        val url: String? = null,
        /** The document itself, as text. Bounded by the server's request cap. */
        val document: String? = null,
        val connectionId: String? = null,
        /** Diff against this import instead of the automatically-matched one. */
        val previousImportId: String? = null,
    )

    private fun import(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val body = req.bodyAs<ImportBody>()

        if (body.url.isNullOrBlank() && body.document.isNullOrBlank()) {
            throw ApiError.ValidationError(
                "Supply either `url` to fetch the document, or `document` with its text."
            )
        }

        val bytes = if (!body.url.isNullOrBlank()) fetch(body.url)
        else body.document!!.toByteArray()

        val read = try {
            OpenApiReader.read(bytes)
        } catch (e: OpenApiReader.DocumentException) {
            throw ApiError.ValidationError(e.message ?: "The document could not be read.")
        }

        /*
         * Postman is CONVERTED, not imported separately. Everything downstream —
         * the operation walk, the parameter mapping, the contract generator, the
         * fingerprint, the diff — works on an OpenAPI document, and a second
         * pipeline would be a second copy of all of it that drifts.
         */
        val isPostman = PostmanConverter.looksLikePostman(read.root)
        val conversionNotes: List<String>
        val documentRoot: JsonNode
        if (isPostman) {
            val converted = try {
                PostmanConverter.convert(read.root)
            } catch (e: PostmanConverter.UnsupportedCollection) {
                throw ApiError.ValidationError(e.message ?: "The collection could not be converted.")
            }
            documentRoot = converted.document
            conversionNotes = converted.notes
        } else {
            documentRoot = read.root
            conversionNotes = emptyList()
        }

        val doc = try {
            OpenApiDocument.of(documentRoot)
        } catch (e: OpenApiDocument.UnsupportedDocument) {
            throw ApiError.ValidationError(e.message ?: "This document is not supported.")
        }

        val candidates = SecuritySchemeMapper.candidates(doc)
        val chosenAuth = candidates.firstOrNull()?.auth ?: HttpAuthSpec.InheritConnection
        val baseUrl = doc.baseUrl()

        val connectionId = body.connectionId?.let { validateConnection(it, ctx.workspaceId) }

        val allOperations = doc.operations()
        val drafts = allOperations.map { op ->
            /*
             * Generated eagerly, for every operation, at import time.
             *
             * The alternative is generating on selection, which would need the
             * whole document re-parsed and re-resolved per selection — 12 MB of
             * GitHub, on a click. The cost here is one pass while the person is
             * already waiting for an import.
             */
            val generated = OperationMapper.map(doc, op, chosenAuth, baseUrl)
            SpecOperationDraft(
                operationKey = op.key,
                method = op.method,
                path = op.path,
                summary = op.summary?.take(500),
                description = generated.description,
                tags = op.tags.take(10),
                deprecated = op.deprecated,
                fingerprint = SpecDiff.fingerprint(op, doc),
                httpSpecJson = generated.spec.toJsonString(),
                inputSchemaJson = generated.inputSchema.toString(),
                resultContractJson = generated.resultContract?.toString(),
            )
        }

        val previous = body.previousImportId
            ?.let { imports.findById(UUID.fromString(it), ctx.workspaceId) }
            ?: imports.findPrevious(ctx.workspaceId, body.url, doc.title, excludingId = null)

        val record = imports.create(
            CreateSpecImport(
                workspaceId = ctx.workspaceId,
                environmentId = envId,
                name = body.name?.takeIf { it.isNotBlank() } ?: doc.title,
                sourceKind = if (isPostman) "postman" else "openapi",
                sourceType = if (body.url.isNullOrBlank()) "upload" else "url",
                sourceUrl = body.url,
                documentJson = mapper.writeValueAsString(documentRoot),
                documentSha256 = read.sha256,
                documentBytes = read.byteCount,
                title = doc.title,
                specVersion = doc.specVersion,
                serversJson = mapper.writeValueAsString(doc.servers.map {
                    mapOf("url" to it.url, "description" to it.description)
                }),
                securitySchemesJson = mapper.writeValueAsString(
                    candidates.associate { it.schemeName to candidateJson(it) }
                ),
                operationCount = allOperations.size,
                connectionId = connectionId,
                previousImportId = previous?.id,
                createdBy = req.principal?.appUserId,
            )
        )
        imports.insertOperations(record.id, ctx.workspaceId, drafts)

        val diff = previous?.let { computeDiff(it, record, doc, ctx.workspaceId) }

        return Response.created(
            mapOf(
                "import" to importJson(record),
                "format" to read.format,
                "operations" to drafts.map { operationSummary(it) },
                "auth" to candidates.map { candidateJson(it) },
                /* Postman loses things an OpenAPI document declares. Said at import
                   time rather than discovered later by somebody wondering why their
                   tools have no result contracts. */
                "notes" to conversionNotes,
                "diff" to diff,
            )
        )
    }

    /**
     * Fetch a document by URL, on the user's behalf, safely.
     *
     * ── THIS IS AN SSRF SURFACE AND IS TREATED AS ONE ───────────────────────
     * A user supplies a URL and this process makes the request, so the guard
     * runs before the socket opens and AGAIN after every redirect — a public URL
     * that 302s to `169.254.169.254` is the standard bypass, and `NEVER` for
     * redirects is what closes it. Following manually costs a loop and removes
     * the whole class.
     *
     * The size cap is enforced on the body that arrives, not on `Content-Length`,
     * which a server chooses and can lie about.
     */
    private fun fetch(url: String): ByteArray {
        try {
            SsrfGuard.validate(url)
        } catch (e: SsrfGuard.SsrfBlockedException) {
            throw ApiError.ValidationError(
                "That URL cannot be fetched: ${e.message}. Upload the document instead."
            )
        }

        var current = url
        for (hop in 0..MAX_REDIRECTS) {
            val response = try {
                httpClient.send(
                    HttpRequest.newBuilder()
                        .uri(URI.create(current))
                        .header("Accept", "application/json, application/yaml, text/yaml, */*")
                        .header("User-Agent", "Vectorbea-SpecImport/1")
                        .timeout(Duration.ofSeconds(30))
                        .GET().build(),
                    HttpResponse.BodyHandlers.ofByteArray(),
                )
            } catch (e: Exception) {
                throw ApiError.ValidationError(
                    "Could not fetch that URL: ${e.javaClass.simpleName}. Check it is " +
                        "reachable from the internet, or upload the document."
                )
            }

            if (response.statusCode() in 300..399) {
                val location = response.headers().firstValue("location").orElse(null)
                    ?: throw ApiError.ValidationError("That URL redirected without a destination.")
                current = URI.create(current).resolve(location).toString()
                /* Re-checked on EVERY hop. A public URL redirecting to a private
                   address is the standard SSRF bypass, and checking only the first
                   one is the standard mistake. */
                try {
                    SsrfGuard.validate(current)
                } catch (e: SsrfGuard.SsrfBlockedException) {
                    throw ApiError.ValidationError(
                        "That URL redirects somewhere that cannot be fetched: ${e.message}."
                    )
                }
                continue
            }

            if (response.statusCode() !in 200..299) {
                throw ApiError.ValidationError(
                    "That URL returned HTTP ${response.statusCode()}. Check the link, or " +
                        "upload the document if it needs authentication."
                )
            }

            val bytes = response.body()
            if (bytes.size > OpenApiReader.MAX_DOCUMENT_BYTES) {
                throw ApiError.ValidationError(
                    "That document is ${bytes.size / (1024 * 1024)} MB, over the " +
                        "${OpenApiReader.MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit."
                )
            }
            return bytes
        }
        throw ApiError.ValidationError("That URL redirected more than $MAX_REDIRECTS times.")
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        val page = imports.list(ctx.workspaceId, ctx.environmentId, req.pageParams())
        return Response.ok(
            com.vectorbea.api.repository.Page(
                items = page.items.map { importJson(it) },
                total = page.total, page = page.page, pageSize = page.pageSize,
            )
        )
    }

    private fun detail(req: Request): Response {
        val ctx = req.context()
        val record = imports.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Import")
        return Response.ok(importJson(record))
    }

    private fun operations(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        imports.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Import")

        val tagFilter = req.query("tag")
        val search = req.query("q")?.lowercase()

        val rows = imports.operations(id, ctx.workspaceId).filter { op ->
            (tagFilter == null || tagFilter in op.tags) &&
                (search == null || op.path.lowercase().contains(search) ||
                    op.summary?.lowercase()?.contains(search) == true ||
                    op.operationKey.lowercase().contains(search))
        }

        return Response.ok(
            mapOf(
                "items" to rows.map { op ->
                    mapOf(
                        "operationKey" to op.operationKey,
                        "method" to op.method,
                        "path" to op.path,
                        "summary" to op.summary,
                        "description" to op.description,
                        "tags" to op.tags,
                        "deprecated" to op.deprecated,
                        "toolId" to op.toolId?.toString(),
                        "httpSpec" to op.httpSpecJson?.let { parse(it) },
                        "inputSchema" to op.inputSchemaJson?.let { parse(it) },
                        "resultContract" to op.resultContractJson?.let { parse(it) },
                    )
                },
                /* The tag list drives the filter chips. Computed here rather than
                   in the browser because the browser would need every operation to
                   compute it, which is the payload this filter exists to avoid. */
                "tags" to rows.flatMap { it.tags }.distinct().sorted(),
                "total" to rows.size,
            )
        )
    }

    // ── Diff ─────────────────────────────────────────────────────────────────

    private fun diff(req: Request): Response {
        val ctx = req.context()
        val current = imports.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Import")
        val previousId = req.query("previousImportId")?.let { UUID.fromString(it) }
            ?: current.previousImportId
            ?: throw ApiError.ValidationError(
                "There is no earlier import of this document to compare against."
            )
        val previous = imports.findById(previousId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Previous import")

        val doc = documentOf(current, ctx.workspaceId)
        return Response.ok(computeDiff(previous, current, doc, ctx.workspaceId))
    }

    private fun computeDiff(
        previous: SpecImport,
        current: SpecImport,
        currentDoc: OpenApiDocument,
        workspaceId: UUID,
    ): Map<String, Any?> {
        val previousRows = imports.previousForDiff(previous.id, workspaceId).map { row ->
            SpecDiff.PreviousOperation(
                operationKey = row.operationKey,
                fingerprint = row.fingerprint,
                method = row.method,
                path = row.path,
                summary = row.summary,
                toolId = row.toolId?.toString(),
                isGranted = row.isGranted,
                httpSpecJson = parseNode(row.httpSpecJson),
            )
        }
        val result = SpecDiff.diff(previousRows, currentDoc.operations(), currentDoc)

        return mapOf(
            "previousImportId" to previous.id.toString(),
            "currentImportId" to current.id.toString(),
            "hasChanges" to result.hasChanges,
            "added" to result.added.map { changeJson(it) },
            "changed" to result.changed.map { changeJson(it) },
            "removed" to result.removed.map { changeJson(it) },
            "unchangedCount" to result.unchangedCount,
            /*
             * The list a reviewer reads first. A change to a tool an agent holds
             * is a security review; a change to one nobody has granted is a chore,
             * and mixing them in one list is how the security review stops being
             * read.
             */
            "affectingGrantedTools" to result.affectingGrantedTools.map { changeJson(it) },
        )
    }

    private fun changeJson(c: SpecDiff.OperationChange) = mapOf(
        "operationKey" to c.operationKey,
        "kind" to c.kind.name.lowercase(),
        "method" to c.method,
        "path" to c.path,
        "summary" to c.summary,
        "toolId" to c.toolId,
        "isGranted" to c.isGranted,
        "details" to c.details,
    )

    // ── Selection: operations become tools ───────────────────────────────────

    private data class CreateToolsBody(
        val operationKeys: List<String>? = null,
        val connectionId: String? = null,
    )

    /**
     * Turn selected operations into tools.
     *
     * ── AN OPERATION ALREADY BACKED BY A TOOL BECOMES A VERSION ─────────────
     * Re-selecting an operation that already has a tool does NOT overwrite it. It
     * writes a pending `tool_versions` row, exactly as a re-import diff does, and
     * the person applies it. Otherwise "select these forty again" would be a
     * silent mass edit of forty granted tools, which is the failure item 12
     * exists to prevent — reached through a different button.
     */
    private fun createTools(req: Request): Response {
        val ctx = req.context()
        val envId = ctx.requireEnvironmentId()
        val importId = req.pathUUID("id")
        val record = imports.findById(importId, ctx.workspaceId) ?: throw ApiError.NotFound("Import")
        val body = req.bodyAs<CreateToolsBody>()

        val keys = body.operationKeys?.takeIf { it.isNotEmpty() }
            ?: throw ApiError.ValidationError("Select at least one operation.")
        if (keys.size > MAX_TOOLS_PER_REQUEST) {
            throw ApiError.ValidationError(
                "Select at most $MAX_TOOLS_PER_REQUEST operations at a time. " +
                    "Importing hundreds of tools at once makes the registry unusable."
            )
        }

        val operations = keys.map { key ->
            key to (imports.operation(importId, ctx.workspaceId, key)
                ?: throw ApiError.ValidationError("This import has no operation '$key'."))
        }

        /* A connection is asked for when the operations need one, and not
           otherwise — see `connectionRequirement`. This used to be unconditional,
           which made a public API a dead end: a document declaring no security
           skips the credential step in the wizard, and the Create button was then
           disabled with nothing left on screen to satisfy it. */
        val connectionId = body.connectionId?.let { validateConnection(it, ctx.workspaceId) }
            ?: record.connectionId
            ?: connectionRequirement(operations)?.let { throw ApiError.ValidationError(it) }

        val created = ArrayList<Map<String, Any?>>()
        val pending = ArrayList<Map<String, Any?>>()

        for ((key, op) in operations) {
            val spec = op.httpSpecJson
                ?: throw ApiError.ValidationError("Operation '$key' produced no usable definition.")

            /* Belt and braces. The generator cannot emit a credential, and this is
               the check that keeps that true when somebody edits the generator. */
            SpecSecretScan.findInlineSecret(parseNode(spec))?.let {
                throw ApiError.ValidationError("Operation '$key' would store $it")
            }

            val existing = op.toolId?.let { tools.findById(it, ctx.workspaceId) }
            if (existing != null) {
                val version = versions.create(
                    CreateToolVersion(
                        toolId = existing.id,
                        workspaceId = ctx.workspaceId,
                        name = existing.name,
                        description = op.description,
                        connectionId = connectionId,
                        inputSchemaJson = op.inputSchemaJson ?: "{}",
                        configJson = existing.configJson,
                        httpSpecJson = spec,
                        resultContractJson = op.resultContractJson,
                        riskLevel = existing.riskLevel,
                        requiresApproval = existing.requiresApproval,
                        timeoutMs = existing.timeoutMs,
                        reviewState = "pending",
                        source = if (record.sourceKind == "postman") "postman_import" else "openapi_import",
                        specImportId = importId,
                        changeSummary = "Re-selected from the import '${record.name}'.",
                        changeJson = null,
                        createdBy = req.principal?.appUserId,
                    )
                )
                pending += mapOf(
                    "operationKey" to key,
                    "toolId" to existing.id.toString(),
                    "versionId" to version.id.toString(),
                    "version" to version.version,
                )
                continue
            }

            val generatedName = op.summary?.takeIf { it.isNotBlank() } ?: "${op.method} ${op.path}"
            val tool = tools.create(
                CreateToolRequest(
                    workspaceId = ctx.workspaceId,
                    environmentId = envId,
                    name = generatedName.take(255),
                    slug = uniqueSlug(slugify(key), ctx.workspaceId),
                    type = "http",
                    description = op.description,
                    connectionId = connectionId,
                    inputSchema = parseMap(op.inputSchemaJson),
                    config = emptyMap(),
                    riskLevel = riskOf(op.method, op.path, op.summary),
                    requiresApproval = riskOf(op.method, op.path, op.summary) in setOf("high", "critical"),
                )
            )
            /*
             * `http_spec_json` and `result_contract_json` are written separately
             * because `CreateToolRequest` predates both and every other caller
             * would have to grow two fields it has no value for. The write is
             * unconditional and immediately after the insert, so a tool never
             * exists without its spec.
             */
            writeSpec(tool.id, ctx.workspaceId, spec, op.resultContractJson)

            versions.create(
                CreateToolVersion(
                    toolId = tool.id,
                    workspaceId = ctx.workspaceId,
                    name = tool.name,
                    description = op.description,
                    connectionId = connectionId,
                    inputSchemaJson = op.inputSchemaJson ?: "{}",
                    configJson = "{}",
                    httpSpecJson = spec,
                    resultContractJson = op.resultContractJson,
                    riskLevel = tool.riskLevel,
                    requiresApproval = tool.requiresApproval,
                    timeoutMs = tool.timeoutMs,
                    /* Version 1 IS the tool, so it is applied on arrival — there is
                       nothing to review against. */
                    reviewState = "applied",
                    source = if (record.sourceKind == "postman") "postman_import" else "openapi_import",
                    specImportId = importId,
                    changeSummary = "Imported from '${record.name}'.",
                    changeJson = null,
                    createdBy = req.principal?.appUserId,
                )
            )

            imports.linkTool(importId, ctx.workspaceId, key, tool.id)
            created += mapOf(
                "operationKey" to key,
                "toolId" to tool.id.toString(),
                "name" to tool.name,
                "riskLevel" to tool.riskLevel,
            )
        }

        if (record.connectionId == null && connectionId != null) {
            imports.attachConnection(importId, ctx.workspaceId, connectionId)
        }

        return Response.created(
            mapOf(
                "created" to created,
                "pendingReview" to pending,
                "message" to buildString {
                    append("Created ${created.size} tool${if (created.size == 1) "" else "s"}.")
                    if (pending.isNotEmpty()) {
                        append(" ${pending.size} already existed and are waiting for review — ")
                        append("an existing tool is never changed in place.")
                    }
                },
            )
        )
    }

    private data class UpdateImportBody(val connectionId: String? = null, val name: String? = null)

    private fun update(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        imports.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Import")
        val body = req.bodyAs<UpdateImportBody>()
        body.connectionId?.let {
            imports.attachConnection(id, ctx.workspaceId, validateConnection(it, ctx.workspaceId))
        }
        return Response.ok(mapOf("ok" to true))
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun documentOf(record: SpecImport, workspaceId: UUID): OpenApiDocument {
        val text = imports.documentOf(record.id, workspaceId)
            ?: throw ApiError.NotFound("Import document")
        return OpenApiDocument.of(mapper.readTree(text))
    }

    private fun writeSpec(
        toolId: UUID,
        workspaceId: UUID,
        specJson: String,
        contractJson: String?,
    ) {
        dataSource.withConnection { conn ->
            conn.prepareStatement(
                """UPDATE tools
                      SET http_spec_json = ?::jsonb,
                          result_contract_json = ?::jsonb,
                          updated_at = now()
                    WHERE id = ? AND workspace_id = ?"""
            ).use { stmt ->
                stmt.setString(1, specJson)
                stmt.setString(2, contractJson)
                stmt.setObject(3, toolId)
                stmt.setObject(4, workspaceId)
                stmt.executeUpdate()
            }
        }
    }

    /**
     * A slug nothing else in the workspace holds.
     *
     * An import of forty operations will collide with an earlier import of the
     * same API, and a unique-constraint violation on the eleventh of forty leaves
     * ten tools created and thirty not. Suffixing is not elegant and it does not
     * leave a half-finished import behind.
     */
    private fun uniqueSlug(base: String, workspaceId: UUID): String {
        val trimmed = base.take(80).ifBlank { "imported-tool" }
        val taken = dataSource.withConnection { conn ->
            conn.prepareStatement(
                "SELECT slug FROM tools WHERE workspace_id = ? AND slug LIKE ?"
            ).use { stmt ->
                stmt.setObject(1, workspaceId)
                stmt.setString(2, "$trimmed%")
                stmt.executeQuery().use { rs ->
                    buildSet { while (rs.next()) add(rs.getString("slug")) }
                }
            }
        }
        if (trimmed !in taken) return trimmed
        var n = 2
        while ("$trimmed-$n" in taken) n++
        return "$trimmed-$n"
    }

    private fun validateConnection(raw: String, workspaceId: UUID): UUID {
        val id = try {
            UUID.fromString(raw)
        } catch (_: IllegalArgumentException) {
            throw ApiError.ValidationError("connectionId must be a valid UUID")
        }
        val conn = connections.findById(id, workspaceId)
            ?: throw ApiError.ValidationError("connectionId '$id' is not in this workspace")
        if (conn.type !in setOf("http", "tool")) {
            throw ApiError.ValidationError(
                "Imported tools need an HTTP connection; '${conn.name}' is a ${conn.type} connection."
            )
        }
        return id
    }

    /**
     * Why these operations need a connection, or null when they do not.
     *
     * An HTTP tool has not required a connection since V064 — see
     * `toolRequiresConnection`. The generated spec carries the document's own
     * `servers` entry as an absolute `baseUrl`, and an operation under no
     * security scheme maps to `inherit`, which with no connection behind it is
     * `AuthApplier`'s no-op. Such a tool runs under `EgressPolicy.PUBLIC` and can
     * reach strictly less than one with a connection, never more. Demanding one
     * anyway is what made a public API an import that could be read and never
     * finished.
     *
     * Two things genuinely still need one, and each names itself rather than
     * arriving as one sentence about credentials:
     *
     *  - **No absolute base URL.** A document whose server is relative (`/v3`)
     *    or absent says where to send nothing; the connection's `baseUrl` is the
     *    only other source of a host.
     *  - **A strategy that reads a secret.** Every strategy but `inherit` and
     *    `none` names FIELDS of a connection's secret bundle (§2.3), so without
     *    a bundle to read them from the first call is a 401 blaming a credential
     *    that was never configured.
     *
     * An unparseable definition is treated as needing one: the generator cannot
     * produce it, so reaching here means something is wrong and refusing is the
     * conservative direction.
     */
    private fun connectionRequirement(
        operations: List<Pair<String, com.vectorbea.api.repository.SpecOperation>>,
    ): String? {
        val needsHost = ArrayList<String>()
        val needsSecret = ArrayList<String>()

        for ((key, op) in operations) {
            val spec = com.vectorbea.worker.tools.httpspec.HttpToolSpec.parse(op.httpSpecJson)
            if (spec == null) {
                needsHost += key
                continue
            }
            val base = spec.request.baseUrl?.trim().orEmpty()
            if (!base.startsWith("http://") && !base.startsWith("https://")) needsHost += key
            if (spec.auth !is HttpAuthSpec.InheritConnection && spec.auth !is HttpAuthSpec.None) {
                needsSecret += key
            }
        }

        return when {
            needsHost.isNotEmpty() -> "This document declares no absolute server URL, so " +
                "${describe(needsHost)} has nowhere to send its request. Choose a connection — its " +
                "base URL becomes the host — or re-import a document whose `servers` entry is absolute."

            needsSecret.isNotEmpty() -> "${describe(needsSecret)} authenticates, and the credential " +
                "is stored once, on the connection, not on each tool. Choose the connection these " +
                "tools run as."

            else -> null
        }
    }

    /** "`GET /pets`" for one, "3 operations (`GET /pets`, …)" for several. */
    private fun describe(keys: List<String>): String =
        if (keys.size == 1) "`${keys.first()}`"
        else "${keys.size} of the selected operations (`${keys.take(3).joinToString("`, `")}`…)"

    /** Mirrors `OperationMapper.riskOf`, from the columns kept on the row. */
    private fun riskOf(method: String, path: String, summary: String?): String {
        val haystack = "$path ${summary.orEmpty()}".lowercase()
        return when {
            HIGH_RISK_WORDS.any { it in haystack } && method != "GET" -> "high"
            method == "DELETE" -> "high"
            method in setOf("POST", "PUT", "PATCH") -> "medium"
            else -> "low"
        }
    }

    private fun importJson(record: SpecImport) = mapOf(
        "id" to record.id.toString(),
        "name" to record.name,
        "sourceKind" to record.sourceKind,
        "sourceType" to record.sourceType,
        "sourceUrl" to record.sourceUrl,
        "title" to record.title,
        "specVersion" to record.specVersion,
        "servers" to parse(record.serversJson),
        "securitySchemes" to parse(record.securitySchemesJson),
        "operationCount" to record.operationCount,
        "connectionId" to record.connectionId?.toString(),
        "previousImportId" to record.previousImportId?.toString(),
        "documentBytes" to record.documentBytes,
        "documentSha256" to record.documentSha256,
        "createdAt" to record.createdAt.toString(),
    )

    private fun operationSummary(d: SpecOperationDraft) = mapOf(
        "operationKey" to d.operationKey,
        "method" to d.method,
        "path" to d.path,
        "summary" to d.summary,
        "tags" to d.tags,
        "deprecated" to d.deprecated,
        "hasBody" to (d.httpSpecJson?.contains("\"body\"") == true),
        "hasResultContract" to (d.resultContractJson != null),
    )

    private fun candidateJson(c: SecuritySchemeMapper.Candidate) = mapOf(
        "schemeName" to c.schemeName,
        "strategy" to c.auth.strategy,
        "auth" to parse(specJsonOf(c.auth)),
        "credentialLabel" to c.credentialLabel,
        "requiredSecretFields" to c.requiredSecretFields,
        "operationCount" to c.operationCount,
        "needsInput" to c.needsInput,
        "description" to c.description?.take(400),
    )

    /** An auth strategy on its own, as the UI's form reads it. */
    private fun specJsonOf(auth: HttpAuthSpec): String =
        com.vectorbea.worker.tools.httpspec.HttpToolSpec(
            request = com.vectorbea.worker.tools.httpspec.HttpToolSpec.Request(),
            auth = auth,
        ).toJson().get("auth").toString()

    private fun parse(json: String?): Any? =
        json?.let { runCatching { mapper.readValue(it, Any::class.java) }.getOrNull() }

    /**
     * The same text, as a tree.
     *
     * [parse] produces plain Kotlin collections, which is what the JSON response
     * writer wants; the diff and the secret scan walk a `JsonNode` and would
     * otherwise each need their own reader. Two parses of a small document is
     * cheaper than two ways of reading one.
     */
    private fun parseNode(json: String?): JsonNode? =
        json?.let { runCatching { mapper.readTree(it) }.getOrNull() }

    @Suppress("UNCHECKED_CAST")
    private fun parseMap(json: String?): Map<String, Any> =
        (parse(json) as? Map<String, Any>) ?: emptyMap()

    private companion object {
        const val MAX_REDIRECTS = 5
        const val MAX_TOOLS_PER_REQUEST = 100

        /**
         * Redirects are followed BY HAND, not by the client.
         *
         * `Redirect.NEVER` is the whole point: the JDK would follow a 302 without
         * telling us, so the SSRF check would only ever have seen the first URL.
         */
        val httpClient: HttpClient = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10))
            .build()

        val HIGH_RISK_WORDS = listOf(
            "payment", "charge", "refund", "payout", "transfer", "invoice", "subscription",
            "billing", "card", "bank", "permission", "role", "member", "user", "admin",
            "token", "key", "secret", "credential", "delete", "destroy", "purge",
        )
    }
}
