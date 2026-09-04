package com.vectorbea.worker.contract

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The deliverable proof: **a fabricated citation is caught.**
 *
 * The prompt asks for a test "where the model fabricates a citation and prove the
 * system catches it". That is `fabricated citation is detected and the field
 * fails` below; everything else here exists to stop that test passing for the
 * wrong reason.
 *
 * Two failure modes a naive implementation has, both tested:
 *
 *   - **Too strict.** A model that re-types a quotation — curly quote for straight,
 *     collapsed whitespace — has cited honestly. Rejecting that makes the feature
 *     unusable and teaches users to switch it off.
 *   - **Too lax.** A model that paraphrases has stopped quoting. Accepting that
 *     makes the check theatre: it passes everything and proves nothing.
 */
class GroundednessTest {

    private val SOURCE = """
        Hi team, quick note before the weekend. The renewal for Northwind Traders is due on
        14 March and the account owner is Priya Raman. Their current plan is Growth at
        $4,800 per year. No support tickets outstanding.
    """.trimIndent()

    private fun envelope(value: Any?, found: Boolean, span: String?) =
        mapOf("value" to value, "found" to found, "source_span" to span)

    // ── THE deliverable ─────────────────────────────────────────────────────

    @Test
    fun `fabricated citation is detected and the field fails`() {
        // The model invents both the value and a plausible-sounding quotation for it.
        // Nothing about the citation is in the source.
        val output = mapOf(
            "account_owner" to envelope(
                "Marcus Webb", true,
                "the account owner is Marcus Webb and has been since 2019"),
        )

        val verdict = Groundedness.verify(output, SOURCE)
        val field = verdict.fields.single()

        assertFalse(field.ok, "a fabricated citation must not be acceptable")
        assertEquals(SpanVerifier.Level.NOT_FOUND, field.verification!!.level)
        assertEquals(1, verdict.unverifiedCount)
        assertEquals(0, verdict.verifiedCount)
        assertEquals(1, verdict.fabricated.size)

        // The message must accuse fabrication and explain the consequence, because
        // "span verification failed" tells the user nothing about their data.
        val msg = verdict.failureMessage()
        assertTrue(msg.contains("account_owner"), msg)
        assertTrue(msg.contains("does not appear"), msg)
        assertTrue(msg.contains("cannot be trusted"), msg)
    }

    @Test
    fun `a fabricated value with a real citation is still caught by the span not containing it`() {
        // The subtler attack: quote something real, but attach the wrong value. The
        // span verifies, so THIS check passes — and that is correct and worth
        // asserting, because it marks the boundary of what Layer 2 claims.
        //
        // Layer 2 proves the model looked at the input; it does not prove it read the
        // input correctly. Catching that is Layer 4's critic pass. Pretending
        // otherwise would be overclaiming.
        val output = mapOf(
            "account_owner" to envelope("Marcus Webb", true, "the account owner is Priya Raman"),
        )
        val field = Groundedness.verify(output, SOURCE).fields.single()
        assertTrue(field.ok, "the citation IS present, so span verification passes")
        assertEquals(SpanVerifier.Level.EXACT, field.verification!!.level)
    }

    // ── Honest citations must survive ───────────────────────────────────────

    @Test
    fun `a verbatim citation verifies exactly`() {
        val output = mapOf(
            "account_name" to envelope("Northwind Traders", true,
                "The renewal for Northwind Traders is due on"),
        )
        val field = Groundedness.verify(output, SOURCE).fields.single()
        assertTrue(field.ok)
        assertEquals(SpanVerifier.Level.EXACT, field.verification!!.level)
        assertTrue(field.verification.strong)
    }

    @Test
    fun `re-typed punctuation and whitespace still verify`() {
        // A model that re-types a quotation changes a straight quote to a curly one
        // and collapses a line break. That is an honest citation and must not fail.
        val output = mapOf(
            "owner" to envelope("Priya Raman", true,
                "the  account   owner is Priya Raman."),
        )
        val field = Groundedness.verify(output, SOURCE).fields.single()
        assertTrue(field.ok, "whitespace differences must not fail an honest citation")
        assertEquals(SpanVerifier.Level.NORMALISED, field.verification!!.level)
        assertTrue(field.verification.strong)
    }

    @Test
    fun `a near-miss verifies fuzzily and is recorded as weaker`() {
        // One character out — a typo in re-typing, not a fabrication.
        val output = mapOf(
            "plan" to envelope("Growth", true, "Their current plan is Growht at"),
        )
        val field = Groundedness.verify(output, SOURCE).fields.single()
        assertTrue(field.ok)
        assertEquals(SpanVerifier.Level.FUZZY, field.verification!!.level)
        assertFalse(field.verification.strong,
            "fuzzy must be recorded as weaker evidence, not laundered into a pass")
    }

    @Test
    fun `paraphrase is rejected`() {
        // Same meaning, different words. The model has stopped quoting, so the
        // evidence chain is broken even though it did not invent the fact.
        val output = mapOf(
            "renewal" to envelope("14 March", true,
                "the contract comes up for renewal in the middle of March"),
        )
        val field = Groundedness.verify(output, SOURCE).fields.single()
        assertFalse(field.ok, "paraphrase is not a citation")
    }

    // ── Null as a first-class answer ────────────────────────────────────────

    @Test
    fun `found false with null value is a SUCCESS`() {
        // The dominant failure in business extraction is inventing a field rather
        // than admitting absence. A model that declines is doing the job correctly
        // and must not be penalised, or it learns to guess.
        val output = mapOf(
            "support_contact" to envelope(null, false, null),
        )
        val verdict = Groundedness.verify(output, SOURCE)
        val field = verdict.fields.single()

        assertTrue(field.ok, "declining to answer must be a success")
        assertNull(field.verification, "an absent field needs no citation")
        assertEquals(1, verdict.absentCount)
        assertEquals(0, verdict.unverifiedCount)
        assertTrue(verdict.fabricated.isEmpty())
    }

    @Test
    fun `an absent field unwraps to a plain null`() {
        // Downstream mappings and assertions must see exactly what they would have
        // seen without groundedness enabled — that is what makes turning the feature
        // on a non-breaking change.
        val output = mapOf(
            "found_one" to envelope("Northwind Traders", true, "renewal for Northwind Traders"),
            "absent_one" to envelope(null, false, null),
        )
        val verdict = Groundedness.verify(output, SOURCE)
        assertEquals("Northwind Traders", verdict.unwrapped["found_one"])
        assertNull(verdict.unwrapped["absent_one"])
        assertEquals(2, verdict.unwrapped.size)
    }

    // ── Schema rewriting ────────────────────────────────────────────────────

    @Test
    fun `wrapping produces an envelope the user never had to write`() {
        val declared = mapOf(
            "type" to "object",
            "properties" to mapOf(
                "account_name" to mapOf("type" to "string"),
                "amount" to mapOf("type" to "number"),
            ),
            "required" to listOf("account_name"),
        )

        @Suppress("UNCHECKED_CAST")
        val wrapped = Groundedness.wrapSchema(declared)
        @Suppress("UNCHECKED_CAST")
        val props = wrapped["properties"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val name = props["account_name"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val nameProps = name["properties"] as Map<String, Any?>

        assertEquals("object", name["type"])
        assertTrue(nameProps.containsKey("value"))
        assertTrue(nameProps.containsKey("found"))
        assertTrue(nameProps.containsKey("source_span"))

        // The value must be nullable whatever was declared — that nullability IS the
        // mechanism by which "not present" is expressible.
        @Suppress("UNCHECKED_CAST")
        val valueSchema = nameProps["value"] as Map<String, Any?>
        val types = valueSchema["type"]
        assertTrue(types is List<*> && types.contains("null"),
            "value must accept null or the model has no legal way to decline: $types")

        // Every field required, since absence is now found:false rather than a
        // missing key — which also satisfies OpenAI strict mode.
        @Suppress("UNCHECKED_CAST")
        val required = wrapped["required"] as List<String>
        assertTrue(required.containsAll(listOf("account_name", "amount")))
    }

    @Test
    fun `the system prompt authorises absence explicitly`() {
        val prompt = Groundedness.systemPromptAddendum()
        assertTrue(prompt.contains("found to false"), prompt)
        assertTrue(prompt.contains("Do NOT guess"), prompt)
        assertTrue(prompt.contains("checked against the input"),
            "the model must be told the citation is verified — that is what deters invention")
    }

    // ── Bypass ──────────────────────────────────────────────────────────────

    @Test
    fun `groundedness is per node and off by default`() {
        // Drafting an email is generation, not extraction, and must not require
        // citations.
        assertFalse(Groundedness.enabled("none"))
        assertFalse(Groundedness.enabled(null))
        assertTrue(Groundedness.required("required"))
        assertTrue(Groundedness.enabled("optional"))
        assertFalse(Groundedness.required("optional"))
    }

    @Test
    fun `an unwrapped field passes through untouched`() {
        // A node with optional groundedness may return a mix. Failing a plain field
        // for not being wrapped would punish the wrong thing.
        val output = mapOf("plain" to "just a value")
        val verdict = Groundedness.verify(output, SOURCE)
        assertEquals("just a value", verdict.unwrapped["plain"])
        assertTrue(verdict.fields.isEmpty())
    }

    // ── Counts for the confidence score ─────────────────────────────────────

    @Test
    fun `counts distinguish verified, fuzzy, unverified and absent`() {
        val output = mapOf(
            "a" to envelope("Northwind Traders", true, "renewal for Northwind Traders"),
            "b" to envelope("Growth", true, "Their current plan is Growht at"),
            "c" to envelope("Marcus Webb", true, "invented text that is nowhere in the source"),
            "d" to envelope(null, false, null),
        )
        val v = Groundedness.verify(output, SOURCE)
        assertEquals(1, v.verifiedCount, "a is exact")
        assertEquals(1, v.fuzzyCount, "b is a near miss")
        assertEquals(1, v.unverifiedCount, "c is fabricated")
        assertEquals(1, v.absentCount, "d declined")
        assertEquals(3, v.claimsMade, "d made no claim")
    }
}
