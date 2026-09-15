package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Re-import produces a diff, and the diff says the right things.
 *
 * ── WHAT THIS IS PROTECTING ─────────────────────────────────────────────────
 * `agents.allowed_tool_ids` grants a tool by uuid. If a re-import rewrote tools
 * in place, an agent granted `create_refund` — scoped by a bound maximum amount
 * — could be regranted a wider version of it by somebody pasting a URL, and
 * nothing would say so.
 *
 * Two properties make that impossible, and both are tested here:
 *
 *   1. The diff NOTICES a behaviour change, and names it in terms a reviewer
 *      decides on ("new REQUIRED parameter", "no longer required").
 *   2. The diff IGNORES a cosmetic change. That half matters just as much: a
 *      vendor rewording prose across nine hundred operations would otherwise
 *      present as nine hundred reviews, and a nine-hundred-item review is one
 *      nobody performs — which leaves the one real change unnoticed among them.
 *
 * The third property — that a re-import never mutates `tools` — is structural
 * rather than testable here: `ApiSpecRoutes` writes `tool_versions` rows with
 * `review_state = 'pending'`, and `ToolVersionRepository.apply` is the only
 * writer of the live definition.
 */
class SpecDiffTest {

    private val mapper = ObjectMapper()

    private fun doc(json: String): OpenApiDocument =
        OpenApiDocument.of(mapper.readTree(json))

    private fun baseSpec(
        limitRequired: Boolean = false,
        extraParam: String? = null,
        description: String = "List the widgets.",
        statusEnum: String = """["open","closed"]""",
    ) = """
    {
      "openapi": "3.0.3",
      "info": {"title": "Widgets", "version": "1.0.0"},
      "servers": [{"url": "https://api.example.com"}],
      "paths": {
        "/widgets": {
          "get": {
            "operationId": "listWidgets",
            "summary": "List widgets",
            "description": ${mapper.writeValueAsString(description)},
            "parameters": [
              {"name": "limit", "in": "query", "required": $limitRequired,
               "schema": {"type": "integer", "default": 25}},
              {"name": "status", "in": "query",
               "schema": {"type": "string", "enum": $statusEnum}}
              ${extraParam?.let { ", $it" } ?: ""}
            ],
            "responses": {
              "200": {"description": "OK", "content": {"application/json":
                {"schema": {"type": "object", "properties": {
                  "data": {"type": "array", "items": {"type": "object",
                    "properties": {"id": {"type": "string"}, "name": {"type": "string"}}}},
                  "total": {"type": "integer"}}}}}}
            }
          },
          "delete": {
            "operationId": "purgeWidgets",
            "summary": "Delete every widget",
            "responses": {"204": {"description": "Gone"}}
          }
        }
      }
    }
    """.trimIndent()

    private fun previousOf(
        json: String,
        grantedKeys: Set<String> = emptySet(),
    ): List<SpecDiff.PreviousOperation> {
        val d = doc(json)
        return d.operations().map { op ->
            val generated = OperationMapper.map(d, op, HttpAuthSpec.None, d.baseUrl())
            SpecDiff.PreviousOperation(
                operationKey = op.key,
                fingerprint = SpecDiff.fingerprint(op, d),
                method = op.method,
                path = op.path,
                summary = op.summary,
                toolId = "tool-${op.key}",
                isGranted = op.key in grantedKeys,
                httpSpecJson = generated.spec.toJson(),
            )
        }
    }

    // ── The cosmetic half ────────────────────────────────────────────────────

    @Test
    fun `an identical document produces no changes`() {
        val d = doc(baseSpec())
        val result = SpecDiff.diff(previousOf(baseSpec()), d.operations(), d)

        assertFalse(result.hasChanges, "an unchanged document must not ask for a review")
        assertEquals(2, result.unchangedCount)
    }

    @Test
    fun `a reworded description is not a change`() {
        val after = doc(baseSpec(description = "Returns a paginated list of every widget you own."))
        val result = SpecDiff.diff(previousOf(baseSpec()), after.operations(), after)

        assertFalse(
            result.hasChanges,
            "a vendor rewording prose must not present as a change. Nine hundred " +
                "operations of that is a review nobody reads, which is how the one " +
                "real change goes unnoticed.",
        )
    }

    // ── The behavioural half ─────────────────────────────────────────────────

    @Test
    fun `a newly required parameter is reported as one, and named`() {
        val after = doc(baseSpec(limitRequired = true))
        val result = SpecDiff.diff(previousOf(baseSpec()), after.operations(), after)

        assertTrue(result.hasChanges)
        assertEquals(1, result.changed.size)
        val change = result.changed.single()
        assertEquals("listWidgets", change.operationKey)
        assertTrue(
            change.details.any { "limit" in it && "required" in it.lowercase() },
            "the reviewer is told WHICH parameter and HOW it changed: ${change.details}",
        )
    }

    @Test
    fun `a new parameter and a widened enum are both reported`() {
        val after = doc(
            baseSpec(
                extraParam = """{"name": "ownerId", "in": "query", "required": true,
                                 "schema": {"type": "string"}}""",
                statusEnum = """["open","closed","archived"]""",
            )
        )
        val result = SpecDiff.diff(previousOf(baseSpec()), after.operations(), after)

        val details = result.changed.single().details.joinToString(" | ")
        assertTrue(
            "ownerId" in details && "REQUIRED" in details,
            "a new required parameter breaks every call that worked before: $details",
        )
        assertTrue(
            "archived" in details,
            "a widened enum widens what a granted agent can ask for: $details",
        )
    }

    @Test
    fun `a removed operation is reported, and says the tool still works`() {
        val after = doc(
            """
            {"openapi":"3.0.3","info":{"title":"Widgets","version":"1.0.0"},
             "paths":{"/widgets":{"get":{"operationId":"listWidgets","summary":"List widgets",
               "parameters":[{"name":"limit","in":"query","schema":{"type":"integer","default":25}},
                             {"name":"status","in":"query","schema":{"type":"string","enum":["open","closed"]}}],
               "responses":{"200":{"description":"OK"}}}}}}
            """.trimIndent()
        )
        val result = SpecDiff.diff(previousOf(baseSpec()), after.operations(), after)

        assertEquals(1, result.removed.size)
        val removed = result.removed.single()
        assertEquals("purgeWidgets", removed.operationKey)
        assertTrue(
            removed.details.any { "still" in it.lowercase() },
            "a removed operation's tool keeps working until the vendor turns the " +
                "endpoint off, and the review must say so: ${removed.details}",
        )
    }

    @Test
    fun `a new operation is added rather than changed`() {
        val after = doc(
            baseSpec().replace(
                """"/widgets": {""",
                """"/gadgets": {"get": {"operationId": "listGadgets", "summary": "List gadgets",
                     "responses": {"200": {"description": "OK"}}}},
                   "/widgets": {"""
            )
        )
        val result = SpecDiff.diff(previousOf(baseSpec()), after.operations(), after)

        assertEquals(listOf("listGadgets"), result.added.map { it.operationKey })
        assertTrue(result.changed.isEmpty(), "an addition must not read as a change")
    }

    // ── Grants are what make a change a review ───────────────────────────────

    @Test
    fun `changes to granted tools are surfaced separately`() {
        val after = doc(baseSpec(limitRequired = true))
        val result = SpecDiff.diff(
            previousOf(baseSpec(), grantedKeys = setOf("listWidgets")),
            after.operations(), after,
        )

        assertEquals(1, result.affectingGrantedTools.size)
        assertTrue(result.affectingGrantedTools.single().isGranted)
        assertEquals("tool-listWidgets", result.affectingGrantedTools.single().toolId)
    }

    @Test
    fun `an ungranted change is not in the granted list`() {
        val after = doc(baseSpec(limitRequired = true))
        val result = SpecDiff.diff(previousOf(baseSpec()), after.operations(), after)

        assertTrue(result.changed.isNotEmpty())
        assertTrue(
            result.affectingGrantedTools.isEmpty(),
            "a pending change to a tool nobody has granted is a chore, not a security " +
                "review, and mixing the two is how the review stops being read",
        )
    }

    // ── The fingerprint itself ───────────────────────────────────────────────

    @Test
    fun `the fingerprint is stable across serialisation differences`() {
        val a = doc(baseSpec())
        /* Same operation, keys in a different order and with an added example —
           which is what a vendor's generator changing version looks like. */
        val b = doc(
            baseSpec().replace(
                """{"name": "limit", "in": "query", "required": false,
               "schema": {"type": "integer", "default": 25}}""",
                """{"schema": {"default": 25, "type": "integer", "example": 10},
               "required": false, "in": "query", "name": "limit"}"""
            )
        )
        val opA = a.operations().first { it.key == "listWidgets" }
        val opB = b.operations().first { it.key == "listWidgets" }

        assertEquals(
            SpecDiff.fingerprint(opA, a), SpecDiff.fingerprint(opB, b),
            "key order and examples are not behaviour; a fingerprint that changed " +
                "with them would ask for a review on every re-import",
        )
    }

    @Test
    fun `deprecation is behaviour and changes the fingerprint`() {
        val a = doc(baseSpec())
        val b = doc(baseSpec().replace(""""operationId": "listWidgets",""",
            """"operationId": "listWidgets", "deprecated": true,"""))

        assertTrue(
            SpecDiff.fingerprint(a.operations().first { it.key == "listWidgets" }, a) !=
                SpecDiff.fingerprint(b.operations().first { it.key == "listWidgets" }, b),
            "an operation the vendor has deprecated is one an agent should stop " +
                "being granted, so it must reach a review",
        )
    }
}
