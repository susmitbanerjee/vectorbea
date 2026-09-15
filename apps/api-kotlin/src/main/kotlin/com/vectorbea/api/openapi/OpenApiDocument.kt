package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode

/**
 * A parsed OpenAPI 3.x document, and the walk over its operations.
 *
 * ── `$ref` IS RESOLVED HERE, ONCE, AND ONLY INTERNALLY ──────────────────────
 * Every consumer downstream — the operation list, the input-schema generator,
 * the result-contract generator, the fingerprint — wants a schema it can read
 * without thinking about references. Resolving in each of them would be four
 * implementations of one thing, and the cycle handling would be wrong in at
 * least one.
 *
 * EXTERNAL references are refused, deliberately and with a message saying so.
 * `$ref: "https://internal.corp/schemas/user.yaml"` in a document a user pasted
 * a URL to is a request the API process would make on their behalf, to an
 * address they chose — which is server-side request forgery with extra steps.
 * A bundled document is the supported path, and `redocly bundle` produces one.
 *
 * ── CYCLES ARE REAL AND MUST NOT HANG ───────────────────────────────────────
 * A `Comment` with an `author` of type `User` with a list of `Comment` is an
 * ordinary schema and an infinite tree. Resolution is depth-bounded and
 * remembers the refs on its current path, so a cycle stops with a placeholder
 * rather than exhausting the stack. GitHub's document contains several.
 */
class OpenApiDocument private constructor(
    val root: JsonNode,
    val title: String,
    val version: String,
    val specVersion: String,
    val servers: List<Server>,
    val securitySchemes: Map<String, JsonNode>,
    /** Document-level `security`, applied to any operation without its own. */
    val defaultSecurity: List<SecurityRequirement>,
) {

    private val mapper = ObjectMapper()

    data class Server(val url: String, val description: String?, val variables: Map<String, String>)

    /** One entry of a `security` array: a scheme name and the scopes it asks for. */
    data class SecurityRequirement(val schemeName: String, val scopes: List<String>)

    /** One operation, with everything it needs already resolved. */
    data class Operation(
        /** Stable identity across re-imports. `operationId`, else `METHOD path`. */
        val key: String,
        val operationId: String?,
        val method: String,
        val path: String,
        val summary: String?,
        val description: String?,
        val tags: List<String>,
        val deprecated: Boolean,
        /** Path-level and operation-level parameters, merged and de-duplicated. */
        val parameters: List<JsonNode>,
        val requestBody: JsonNode?,
        val responses: JsonNode?,
        val security: List<SecurityRequirement>,
        /** The server this operation overrides to, when it declares one. */
        val serverUrl: String?,
    )

    class UnsupportedDocument(message: String) : Exception(message)

    // ── Operations ───────────────────────────────────────────────────────────

    /**
     * Every operation in the document, in document order.
     *
     * Document order is kept because it is the order the vendor's own
     * documentation uses, and a list of nine hundred operations sorted
     * alphabetically is harder to find anything in than one grouped the way the
     * reader has already seen.
     */
    fun operations(): List<Operation> {
        val paths = root.get("paths") as? ObjectNode ?: return emptyList()
        val out = ArrayList<Operation>()

        paths.fields().forEach { (path, pathItemRaw) ->
            val pathItem = resolve(pathItemRaw) as? ObjectNode ?: return@forEach
            /* Parameters declared on the PATH apply to every operation under it.
               A document that puts `owner` and `repo` there — GitHub's does, for
               hundreds of operations — would otherwise import tools with no path
               parameters at all, producing URLs with `{owner}` left in them. */
            val pathParams = (pathItem.get("parameters") as? ArrayNode)
                ?.map { resolve(it) } ?: emptyList()

            HTTP_METHODS.forEach { method ->
                val opNode = pathItem.get(method) as? ObjectNode ?: return@forEach
                val opParams = (opNode.get("parameters") as? ArrayNode)
                    ?.map { resolve(it) } ?: emptyList()

                /*
                 * An operation-level parameter OVERRIDES a path-level one with the
                 * same (name, in) pair — the spec says so, and it matters: the
                 * override is usually the one that adds a default or narrows an
                 * enum, and taking the path-level copy would quietly widen it.
                 */
                val merged = LinkedHashMap<Pair<String, String>, JsonNode>()
                pathParams.forEach { p -> keyOf(p)?.let { merged[it] = p } }
                opParams.forEach { p -> keyOf(p)?.let { merged[it] = p } }

                val operationId = opNode.get("operationId")?.asText()?.takeIf { it.isNotBlank() }
                out += Operation(
                    key = operationId ?: "${method.uppercase()} $path",
                    operationId = operationId,
                    method = method.uppercase(),
                    path = path,
                    summary = opNode.get("summary")?.asText()?.takeIf { it.isNotBlank() },
                    description = opNode.get("description")?.asText()?.takeIf { it.isNotBlank() },
                    tags = (opNode.get("tags") as? ArrayNode)?.map { it.asText() } ?: emptyList(),
                    deprecated = opNode.path("deprecated").asBoolean(false),
                    parameters = merged.values.toList(),
                    requestBody = opNode.get("requestBody")?.let { resolve(it) },
                    responses = opNode.get("responses")?.let { resolve(it) },
                    security = securityOf(opNode),
                    serverUrl = (opNode.get("servers") as? ArrayNode)?.firstOrNull()
                        ?.get("url")?.asText()?.takeIf { it.isNotBlank() },
                )
            }
        }
        return out
    }

    private fun keyOf(param: JsonNode): Pair<String, String>? {
        val name = param.get("name")?.asText()?.takeIf { it.isNotBlank() } ?: return null
        val location = param.get("in")?.asText()?.takeIf { it.isNotBlank() } ?: return null
        return name to location
    }

    /**
     * An operation's security requirements.
     *
     * An operation with `security: []` — an empty ARRAY, not an absent key — is
     * declaring itself public and overriding the document default. Treating
     * absent and empty the same would put a credential on a login endpoint,
     * which some providers reject outright.
     */
    private fun securityOf(op: ObjectNode): List<SecurityRequirement> {
        val declared = op.get("security") as? ArrayNode ?: return defaultSecurity
        return readSecurity(declared)
    }

    // ── `$ref` resolution ────────────────────────────────────────────────────

    /** Resolve one node's `$ref`, shallowly. Non-refs are returned unchanged. */
    fun resolve(node: JsonNode?): JsonNode {
        if (node == null) return mapper.nullNode()
        val ref = node.get("\$ref")?.asText() ?: return node
        return resolvePointer(ref, mutableSetOf()) ?: node
    }

    /**
     * Resolve a node and everything under it.
     *
     * [maxDepth] and the seen-set together bound a cyclic schema. A cycle
     * resolves to `{"type": "object"}` with a note rather than to nothing: a
     * model shown a field of unknown shape can still pass one through, and a
     * field that vanished silently cannot be passed at all.
     */
    fun resolveDeep(node: JsonNode?, maxDepth: Int = 12): JsonNode =
        resolveDeepInner(node, maxDepth, mutableSetOf())

    private fun resolveDeepInner(
        node: JsonNode?,
        depth: Int,
        seen: MutableSet<String>,
    ): JsonNode {
        if (node == null || node.isNull) return mapper.nullNode()
        if (depth <= 0) return cyclePlaceholder("the schema nests deeper than the importer follows")

        node.get("\$ref")?.asText()?.let { ref ->
            if (ref in seen) return cyclePlaceholder("this schema refers to itself")
            seen += ref
            val target = resolvePointer(ref, seen)
                ?: return cyclePlaceholder("the referenced schema '$ref' is not in this document")
            val resolved = resolveDeepInner(target, depth - 1, seen)
            seen -= ref
            return resolved
        }

        return when {
            node.isObject -> {
                val out = mapper.createObjectNode()
                node.fields().forEach { (k, v) ->
                    out.set<JsonNode>(k, resolveDeepInner(v, depth - 1, seen))
                }
                out
            }

            node.isArray -> {
                val out = mapper.createArrayNode()
                node.forEach { out.add(resolveDeepInner(it, depth - 1, seen)) }
                out
            }

            else -> node
        }
    }

    private fun cyclePlaceholder(why: String): ObjectNode =
        mapper.createObjectNode().apply {
            put("type", "object")
            put("description", "Shape not expanded: $why.")
        }

    /**
     * Follow a JSON pointer within THIS document.
     *
     * External references are refused rather than fetched. See the class comment.
     */
    private fun resolvePointer(ref: String, seen: MutableSet<String>): JsonNode? {
        if (!ref.startsWith("#/")) {
            throw UnsupportedDocument(
                "This document uses an external reference ('${ref.take(80)}'). Bundle it " +
                    "into a single file first — `redocly bundle` or `swagger-cli bundle` " +
                    "both do this — and import the result. External references are not " +
                    "followed: doing so would make this server fetch an address the " +
                    "document chose."
            )
        }
        var cur: JsonNode = root
        for (rawSegment in ref.removePrefix("#/").split('/')) {
            if (rawSegment.isEmpty()) continue
            /* RFC 6901 escaping: `~1` is `/` and `~0` is `~`. Real documents use
               it — every path key containing a slash is written this way. */
            val segment = rawSegment.replace("~1", "/").replace("~0", "~")
            cur = cur.get(segment) ?: return null
        }
        /* A pointer to another pointer. Legal, and rare enough that a bounded
           chain is safer than a loop. */
        cur.get("\$ref")?.asText()?.let { next ->
            if (next in seen || seen.size > 8) return cur
            seen += next
            return resolvePointer(next, seen)
        }
        return cur
    }

    // ── Base URL ─────────────────────────────────────────────────────────────

    /**
     * The base URL an import should use, with server variables substituted.
     *
     * The FIRST server, because that is what the spec means by it and what every
     * other tool does. A relative server URL (`/v3`) is a valid document — the
     * server is "wherever the document was served from" — and cannot be resolved
     * without knowing that, so it is returned as-is for the caller to combine
     * with the import URL.
     */
    fun baseUrl(): String? {
        val server = servers.firstOrNull() ?: return null
        var url = server.url
        server.variables.forEach { (name, default) ->
            url = url.replace("{$name}", default)
        }
        return url.takeIf { it.isNotBlank() }
    }

    companion object {
        private val HTTP_METHODS = listOf("get", "put", "post", "delete", "patch", "head", "options", "trace")

        private val mapper = ObjectMapper()

        /**
         * Build from a parsed root.
         *
         * Swagger 2.0 is REFUSED with a sentence naming the converter, rather
         * than half-parsed. The two formats disagree about where request bodies,
         * content types and security live, so a 2.0 document read as 3.x produces
         * tools with no body and no auth — which look fine until they are called.
         */
        fun of(root: JsonNode): OpenApiDocument {
            root.get("swagger")?.asText()?.let { v ->
                if (v.startsWith("2")) throw UnsupportedDocument(
                    "This is a Swagger 2.0 document. Convert it to OpenAPI 3 first — " +
                        "`swagger2openapi` does this in one command — and import the result."
                )
            }
            val specVersion = root.get("openapi")?.asText()
                ?: throw UnsupportedDocument(
                    "This document has no `openapi` version field, so it is not an " +
                        "OpenAPI 3 document."
                )
            if (!specVersion.startsWith("3")) throw UnsupportedDocument(
                "OpenAPI $specVersion is not supported. This importer reads 3.0 and 3.1."
            )

            val info = root.get("info")
            val components = root.get("components")

            return OpenApiDocument(
                root = root,
                title = info?.get("title")?.asText()?.takeIf { it.isNotBlank() } ?: "Imported API",
                version = info?.get("version")?.asText()?.takeIf { it.isNotBlank() } ?: "",
                specVersion = specVersion,
                servers = readServers(root),
                securitySchemes = (components?.get("securitySchemes") as? ObjectNode)
                    ?.fields()?.asSequence()?.associate { (k, v) -> k to v } ?: emptyMap(),
                defaultSecurity = readSecurity(root.get("security") as? ArrayNode),
            )
        }

        private fun readServers(root: JsonNode): List<Server> =
            (root.get("servers") as? ArrayNode)?.mapNotNull { s ->
                val url = s.get("url")?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val variables = (s.get("variables") as? ObjectNode)?.fields()?.asSequence()
                    ?.mapNotNull { (name, v) ->
                        /*
                         * A server variable with no default is invalid per the
                         * spec, and appears anyway. Falling back to the first enum
                         * value produces a URL that at least resolves, which beats
                         * a base URL containing a literal `{region}`.
                         */
                        val default = v.get("default")?.asText()
                            ?: (v.get("enum") as? ArrayNode)?.firstOrNull()?.asText()
                            ?: return@mapNotNull null
                        name to default
                    }?.toMap() ?: emptyMap()
                Server(url, s.get("description")?.asText(), variables)
            } ?: emptyList()

        private fun readSecurity(node: ArrayNode?): List<SecurityRequirement> =
            node?.flatMap { requirement ->
                requirement.fields().asSequence().map { (name, scopes) ->
                    SecurityRequirement(
                        schemeName = name,
                        scopes = (scopes as? ArrayNode)?.map { it.asText() } ?: emptyList(),
                    )
                }.toList()
            } ?: emptyList()
    }
}
