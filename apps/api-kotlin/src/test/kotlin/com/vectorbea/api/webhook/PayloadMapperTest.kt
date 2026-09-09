package com.vectorbea.api.webhook

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Turning somebody else's payload into a workflow's inputs.
 *
 * Shared by webhook and event ingress — one vocabulary, on purpose, because two
 * spellings of the same idea would be two things to learn and two to debug.
 */
class PayloadMapperTest {

    private val mapper = ObjectMapper()

    private val stripe = mapper.readTree(
        """
        {
          "id": "evt_1",
          "type": "checkout.session.completed",
          "data": { "object": {
              "id": "cs_test_123",
              "amount_total": 2500,
              "customer_details": { "email": "buyer@example.test" },
              "line_items": [ {"sku": "A"}, {"sku": "B"}, {"sku": "C"} ]
          } }
        }
        """.trimIndent()
    )

    @Test
    fun `an empty mapping passes the body through under a key of its own`() {
        val result = PayloadMapper.map(stripe, emptyMap())
        val mapped = assertIs<PayloadMapper.Result.Mapped>(result)

        assertEquals(setOf("body"), mapped.inputs.keys,
            "the payload was spread at the top level, where a field called `input` " +
                "or `runId` would silently collide with the run's own vocabulary")
    }

    @Test
    fun `a mapping flattens the envelope into named inputs`() {
        val result = PayloadMapper.map(stripe, mapOf(
            "sessionId" to "$.data.object.id",
            "amount" to "$.data.object.amount_total",
            "email" to "$.data.object.customer_details.email",
        ))
        val mapped = assertIs<PayloadMapper.Result.Mapped>(result)

        assertEquals("cs_test_123", mapped.inputs["sessionId"])
        assertEquals(2500, mapped.inputs["amount"])
        assertEquals("buyer@example.test", mapped.inputs["email"])
    }

    @Test
    fun `a leading dollar-dot is optional, because half of everyone omits it`() {
        val withPrefix = PayloadMapper.map(stripe, mapOf("id" to "$.data.object.id"))
        val without = PayloadMapper.map(stripe, mapOf("id" to "data.object.id"))

        assertEquals(
            (withPrefix as PayloadMapper.Result.Mapped).inputs,
            (without as PayloadMapper.Result.Mapped).inputs,
            "refusing one of the two spellings is a support ticket, not a lesson",
        )
    }

    @Test
    fun `array indexes work, and a negative index counts from the end`() {
        val result = PayloadMapper.map(stripe, mapOf(
            "first" to "$.data.object.line_items[0].sku",
            "last" to "$.data.object.line_items[-1].sku",
        ))
        val mapped = assertIs<PayloadMapper.Result.Mapped>(result)
        assertEquals("A", mapped.inputs["first"])
        assertEquals("C", mapped.inputs["last"],
            "'the last element' is a thing people want, and `[-1]` is how they write it")
    }

    @Test
    fun `a missing field is present as null rather than absent`() {
        val result = PayloadMapper.map(stripe, mapOf(
            "sessionId" to "$.data.object.id",
            "phone" to "$.data.object.customer_details.phone",
        ))
        val mapped = assertIs<PayloadMapper.Result.Mapped>(result)

        assertTrue("phone" in mapped.inputs,
            "the key was dropped, so a workflow that declares the input fails on an " +
                "unknown key instead of seeing 'not sent'")
        assertNull(mapped.inputs["phone"])
    }

    @Test
    fun `a mapping where every path misses is its own outcome, not an empty run`() {
        /*
         * The case worth separating. A run started with no inputs from a delivery
         * that HAD them is a workflow doing nothing while appearing to work, and
         * it is nearly always a path typo — so it is recorded as
         * `rejected_mapping` with the paths that missed, which is the answer to
         * "why did my webhook run with no data".
         */
        val result = PayloadMapper.map(stripe, mapOf(
            "orderId" to "$.data.order.id",
            "total" to "$.data.order.total",
        ))
        val empty = assertIs<PayloadMapper.Result.Empty>(result,
            "a delivery whose every mapped path missed was accepted as a run with " +
                "empty inputs")
        assertEquals(setOf("$.data.order.id", "$.data.order.total"), empty.missingPaths.toSet(),
            "the outcome does not name the paths that missed, so the fix is a guess")
    }

    @Test
    fun `a partially matching mapping still runs`() {
        /* One missing field out of three is normal — an optional value the sender
           omitted. Refusing the whole delivery for it would be worse than passing
           a null the workflow can check. */
        val result = PayloadMapper.map(stripe, mapOf(
            "sessionId" to "$.data.object.id",
            "coupon" to "$.data.object.coupon_code",
        ))
        assertIs<PayloadMapper.Result.Mapped>(result)
    }

    @Test
    fun `stringAt reads a filter value, and answers null rather than empty`() {
        assertEquals("checkout.session.completed", PayloadMapper.stringAt(stripe, "$.type"))
        assertNull(PayloadMapper.stringAt(stripe, "$.nope"),
            "a missing event-type field returned the empty string, which would match " +
                "an event-type filter configured with one")
        assertNull(PayloadMapper.stringAt(stripe, null))
    }

    @Test
    fun `a non-string value reads as its JSON form`() {
        /* A dedup key is often a number in the payload and a string in the ledger. */
        assertEquals("2500", PayloadMapper.stringAt(stripe, "$.data.object.amount_total"))
    }

    @Test
    fun `nested objects and arrays survive the round trip`() {
        val result = PayloadMapper.map(stripe, mapOf("items" to "$.data.object.line_items"))
        val mapped = assertIs<PayloadMapper.Result.Mapped>(result)
        val items = assertIs<List<*>>(mapped.inputs["items"])
        assertEquals(3, items.size)
        assertEquals(mapOf("sku" to "A"), items.first())
    }
}
