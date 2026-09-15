package com.vectorbea.api.openapi

import com.fasterxml.jackson.core.StreamReadConstraints
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.dataformat.yaml.YAMLParser
import java.security.MessageDigest

/**
 * Turns the bytes of an API document into a `JsonNode`, safely.
 *
 * ── THE INPUT IS HOSTILE BY CONSTRUCTION ────────────────────────────────────
 * The importer takes a URL or an upload from a user, so everything here is
 * bounded before it is parsed rather than after:
 *
 *   · SIZE. GitHub's own document is 12 MB and Stripe's is 8 MB, so the cap
 *     cannot be small — but it must exist, because without one a 2 GB file is a
 *     2 GB heap allocation on an API process serving everybody else.
 *   · NESTING AND NAME LENGTH. Jackson 2.15 added `StreamReadConstraints`
 *     precisely for documents designed to exhaust a parser. The defaults are
 *     generous enough for a real spec (GitHub nests about 20 deep) and stop the
 *     pathological cases.
 *   · YAML ALIASES. A YAML bomb — a handful of anchors each expanding the last —
 *     is a few hundred bytes that materialise as gigabytes. `MAX_ALIASES` caps
 *     the expansion, which is the only defence that works, because the file is
 *     small right up until it is parsed.
 *
 * ── AND FORMAT IS DETECTED, NOT DECLARED ────────────────────────────────────
 * A URL ending in `.yaml` that serves JSON is common (content negotiation,
 * CDN rewrites, a raw link to a converted file), and so is the reverse. Trying
 * JSON first and falling back to YAML costs one failed parse and removes an
 * entire class of "this is a valid document and your importer says it is not".
 */
object OpenApiReader {

    /** 24 MB. GitHub's document is 12 MB; this is comfortably above the real world. */
    const val MAX_DOCUMENT_BYTES = 24 * 1024 * 1024

    class DocumentException(message: String) : Exception(message)

    private val jsonMapper: ObjectMapper = ObjectMapper().apply {
        factory.setStreamReadConstraints(
            StreamReadConstraints.builder()
                .maxNestingDepth(200)
                .maxStringLength(50_000_000)
                .maxNameLength(50_000)
                .build()
        )
    }

    private val yamlMapper: ObjectMapper = ObjectMapper(
        YAMLFactory.builder()
            .loaderOptions(
                org.yaml.snakeyaml.LoaderOptions().apply {
                    /*
                     * The YAML-bomb cap. 200 is far above what a hand-written spec
                     * uses (Kubernetes' own, the most anchor-heavy in common
                     * circulation, is under 50) and far below what an expansion
                     * attack needs.
                     */
                    maxAliasesForCollections = 200
                    codePointLimit = MAX_DOCUMENT_BYTES
                    setAllowRecursiveKeys(false)
                }
            )
            .build()
    ).apply {
        factory.setStreamReadConstraints(
            StreamReadConstraints.builder()
                .maxNestingDepth(200)
                .maxStringLength(50_000_000)
                .maxNameLength(50_000)
                .build()
        )
    }

    /** What was read, and what it hashes to. */
    data class Document(
        val root: JsonNode,
        /** SHA-256 of the bytes AS FETCHED, before normalisation. */
        val sha256: String,
        val byteCount: Int,
        /** `json` or `yaml`, as detected. */
        val format: String,
    )

    /**
     * Read [bytes].
     *
     * The digest is over the ORIGINAL bytes, not the parsed tree, so a re-import
     * of a byte-identical document is recognised without a parse. Hashing the
     * normalised tree instead would make a vendor's whitespace change look like a
     * new document, which is the noise that stops anybody reading the diff.
     */
    fun read(bytes: ByteArray): Document {
        if (bytes.isEmpty()) throw DocumentException("The document is empty.")
        if (bytes.size > MAX_DOCUMENT_BYTES) {
            throw DocumentException(
                "The document is ${bytes.size / (1024 * 1024)} MB, over the " +
                    "${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit."
            )
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }

        val text = String(bytes, Charsets.UTF_8)
        val looksJson = text.trimStart().firstOrNull() == '{'

        val (root, format) = if (looksJson) {
            parseOrNull(jsonMapper, text)?.let { it to "json" }
                ?: (parse(yamlMapper, text, "YAML") to "yaml")
        } else {
            parseOrNull(yamlMapper, text)?.let { it to "yaml" }
                ?: (parse(jsonMapper, text, "JSON") to "json")
        }

        if (!root.isObject) {
            throw DocumentException(
                "The document parsed, but its top level is not an object. An OpenAPI " +
                    "or Postman document is a single object."
            )
        }
        return Document(root, digest, bytes.size, format)
    }

    private fun parseOrNull(mapper: ObjectMapper, text: String): JsonNode? =
        try {
            mapper.readTree(text)
        } catch (_: Exception) {
            null
        }

    private fun parse(mapper: ObjectMapper, text: String, label: String): JsonNode = try {
        mapper.readTree(text)
    } catch (e: Exception) {
        /*
         * The location is the useful half. Jackson reports line and column, and a
         * person looking at an 8 MB document needs both; the class name of the
         * exception helps nobody.
         */
        val where = (e as? com.fasterxml.jackson.core.JsonProcessingException)?.location
            ?.let { " at line ${it.lineNr}, column ${it.columnNr}" } ?: ""
        throw DocumentException("The document is not valid $label$where: ${e.originalMessage()}")
    }

    private fun Exception.originalMessage(): String =
        (this as? com.fasterxml.jackson.core.JsonProcessingException)?.originalMessage
            ?: message?.take(200) ?: javaClass.simpleName
}
