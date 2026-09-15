package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.worker.tools.httpspec.HttpToolSpec

/**
 * Generates a STARTING result contract from a response schema — item 11.
 *
 * ── "MOST SCHEMAS ARE TOO WIDE FOR A MODEL TO USE WELL" ─────────────────────
 * The brief's own words, and V056 measured it: a 56-field CRM contact is 1788
 * characters, six of eight representative responses truncate, and every
 * truncated one is unparseable JSON. Importing an operation's full response
 * schema as its contract would reproduce that problem at scale — a customer
 * importing forty operations would get forty tools that each blow the
 * observation budget, and would conclude the import feature does not work.
 *
 * So the generator TRIMS, and the brief says "for the user to trim", which is
 * the right split: the generator produces a defensible starting subset, and the
 * person widens or narrows it in the UI. Widening is safe and obvious; the thing
 * a person will not do unprompted is narrow fifty-six fields to ten.
 *
 * ── HOW FIELDS ARE RANKED ───────────────────────────────────────────────────
 * By what an agent uses to make its next decision, which in practice is:
 * identity (`id`, `key`, `number`), naming (`name`, `title`, `subject`), state
 * (`status`, `state`, `type`), the human-facing text (`description`, `body`),
 * time (`created_at`, `updated_at`), and links (`url`, `html_url`). Then
 * required fields, then everything else, capped.
 *
 * Explicitly demoted: anything ending in `_id` that is not `id` (a foreign key
 * an agent cannot resolve), anything whose schema is an object or array (a
 * nested document that costs the budget it would use), and `*_count` fields
 * beyond the first.
 */
internal object ResultContractGenerator {

    private val mapper = ObjectMapper()

    /** How many fields a generated contract declares. */
    private const val MAX_FIELDS = 10

    /** How many elements of a collection the contract samples. */
    private const val SAMPLE = 5

    /**
     * The extraction expression for an operation, if one is worth having.
     *
     * ── ONLY WHEN THE ENVELOPE IS PURE OVERHEAD ─────────────────────────────
     * An extraction that unwraps `{"data": [...]}` to the array throws away
     * `has_more` and `total_count` — which are the two fields that stop a model
     * concluding it has seen everything. So the envelope is unwrapped ONLY when
     * it carries nothing else: a single-property wrapper. Otherwise the contract
     * layer handles the shape, keeping the count and the more-marker, and the
     * extraction stays out of it.
     */
    fun extractionFor(doc: OpenApiDocument, responses: JsonNode?): HttpToolSpec.Extraction {
        val schema = schemaOf(doc, responses) ?: return HttpToolSpec.Extraction.None
        val props = schema.get("properties") as? ObjectNode ?: return HttpToolSpec.Extraction.None
        if (props.size() != 1) return HttpToolSpec.Extraction.None
        val (name, only) = props.fields().next()
        /* A single wrapper whose one field is itself a wrapper is a common
           Salesforce/Jira shape, and unwrapping one level is enough — two levels
           starts removing fields somebody may want. */
        if (OperationMapper.typeOf(only) !in setOf("array", "object")) {
            return HttpToolSpec.Extraction.None
        }
        return HttpToolSpec.Extraction.JsonPath("$.$name")
    }

    /**
     * Build the contract, or null when the response schema says nothing useful.
     *
     * Null rather than an empty contract: `ToolResultContract.parse` treats an
     * empty document as no contract for exactly this reason, and a contract that
     * declares no fields projects every result to `{}`, which reads to a model as
     * "the tool found nothing".
     */
    fun forOperation(
        doc: OpenApiDocument,
        responses: JsonNode?,
        pagination: HttpToolSpec.PaginationSpec,
    ): ObjectNode? {
        val schema = schemaOf(doc, responses) ?: return null

        val collectionPath = PaginationDetector.collectionPathIn(schema)
        val isBareArray = OperationMapper.typeOf(schema) == "array"

        /*
         * Field paths are rooted at the tool's WHOLE result, so they carry the
         * `body.` prefix — `ToolResultContract` documents that, and a DB tool has
         * no `body` at all, which is why the root is the result rather than the
         * response. Inside a collection element the prefix is consumed by the
         * projection layer, so the same paths work in both positions.
         */
        val elementSchema = when {
            isBareArray -> schema.get("items")
            collectionPath != null ->
                (schema.get("properties") as? ObjectNode)?.get(collectionPath)?.get("items")

            else -> schema
        } ?: return null

        val fields = rankedFields(elementSchema)
        if (fields.isEmpty() && collectionPath == null && !isBareArray) return null

        val contract = mapper.createObjectNode()
        contract.put("version", 1)

        if (fields.isNotEmpty()) {
            val arr = contract.putArray("fields")
            fields.forEach { f ->
                arr.addObject().apply {
                    put("path", "body.${f.name}")
                    if (f.agentName != f.name) put("as", f.agentName)
                    f.description?.let { put("desc", it) }
                }
            }
        }

        when {
            isBareArray -> contract.putObject("collection").apply {
                put("path", "body")
                put("sample", SAMPLE)
                moreHintFor(pagination)?.let { put("moreHint", it) }
            }

            collectionPath != null -> contract.putObject("collection").apply {
                put("path", "body.$collectionPath")
                totalPathIn(schema)?.let { put("totalPath", "body.$it") }
                put("sample", SAMPLE)
                moreHintFor(pagination)?.let { put("moreHint", it) }
            }
        }

        return contract
    }

    private fun moreHintFor(pagination: HttpToolSpec.PaginationSpec): String? = when (pagination) {
        is HttpToolSpec.PaginationSpec.None -> null
        else ->
            "The runtime already followed up to ${pagination.maxPages} pages. To see " +
                "different results, narrow the query rather than asking for more."
    }

    private fun totalPathIn(schema: JsonNode): String? {
        val props = schema.get("properties") as? ObjectNode ?: return null
        return TOTAL_KEYS.firstOrNull { key ->
            props.get(key)?.let { OperationMapper.typeOf(it) in setOf("integer", "number") } == true
        }
    }

    private data class Ranked(
        val name: String,
        val agentName: String,
        val description: String?,
        val score: Int,
    )

    private fun rankedFields(elementSchema: JsonNode): List<Ranked> {
        val props = elementSchema.get("properties") as? ObjectNode ?: return emptyList()
        val required = (elementSchema.get("required") as? com.fasterxml.jackson.databind.node.ArrayNode)
            ?.map { it.asText() }?.toSet() ?: emptySet()

        var countFieldsTaken = 0
        val ranked = props.fields().asSequence().map { (name, schema) ->
            val lower = name.lowercase()
            val type = OperationMapper.typeOf(schema)
            var score = when {
                lower == "id" || lower == "key" || lower == "number" || lower == "uid" -> 100
                lower in NAME_KEYS -> 90
                lower in STATE_KEYS -> 85
                lower in TIME_KEYS -> 70
                lower in LINK_KEYS -> 65
                lower in TEXT_KEYS -> 60
                name in required -> 50
                else -> 20
            }
            /* A nested document costs the budget the contract exists to protect,
               and the projection cannot summarise it. Demoted rather than removed:
               sometimes the object IS the answer, and a person can promote it. */
            if (type == "object" || type == "array") score -= 45
            /* A foreign key an agent cannot resolve is a number it will put in a
               sentence. `parent_id` is not `id`. */
            if (lower.endsWith("_id") && lower != "id") score -= 30
            if (lower.endsWith("_count") || lower.endsWith("count")) {
                score -= if (countFieldsTaken++ > 0) 25 else 0
            }
            if (schema.path("deprecated").asBoolean(false)) score -= 40

            Ranked(
                name = name,
                agentName = OperationMapper.agentNameFor(name),
                description = schema.get("description")?.asText()
                    ?.replace(Regex("""\s+"""), " ")?.trim()
                    ?.takeIf { it.isNotBlank() }?.take(MAX_FIELD_DESCRIPTION),
                score = score,
            )
        }.toList()

        return ranked
            .sortedWith(compareByDescending<Ranked> { it.score }.thenBy { it.name })
            .take(MAX_FIELDS)
            /* Back into document order once chosen. A contract read by a person
               beside the vendor's docs is easier to check when the fields are in
               the order the docs list them. */
            .sortedBy { r -> ranked.indexOfFirst { it.name == r.name } }
    }

    private fun schemaOf(doc: OpenApiDocument, responses: JsonNode?): JsonNode? {
        if (responses == null || !responses.isObject) return null
        val success = responses.fields().asSequence()
            .firstOrNull { (code, _) -> code.toIntOrNull()?.let { it in 200..299 } ?: false }
            ?.value ?: return null
        val content = doc.resolve(success).get("content") as? ObjectNode ?: return null
        val json = content.fields().asSequence()
            .firstOrNull { (ct, _) -> ct.startsWith("application/json") || ct.endsWith("+json") }
            ?.value ?: return null
        return doc.resolveDeep(json.get("schema"), maxDepth = 8).takeUnless { it.isNull }
    }

    private const val MAX_FIELD_DESCRIPTION = 120

    private val NAME_KEYS = setOf(
        "name", "title", "subject", "label", "display_name", "displayname",
        "full_name", "fullname", "slug", "email", "login", "username",
    )
    private val STATE_KEYS = setOf(
        "status", "state", "type", "kind", "stage", "phase", "result",
        "amount", "currency", "total", "price", "quantity",
    )
    private val TIME_KEYS = setOf(
        "created_at", "createdat", "created", "updated_at", "updatedat", "updated",
        "due_date", "duedate", "date", "timestamp", "closed_at", "completed_at",
    )
    private val LINK_KEYS = setOf("url", "html_url", "web_url", "link", "permalink", "self")
    private val TEXT_KEYS = setOf("description", "body", "summary", "message", "text", "content", "note")
    private val TOTAL_KEYS = listOf(
        "total", "total_count", "totalCount", "totalSize", "total_results", "count",
    )
}
