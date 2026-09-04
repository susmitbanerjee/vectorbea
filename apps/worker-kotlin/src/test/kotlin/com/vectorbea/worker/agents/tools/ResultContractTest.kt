package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.agents.brain.runtime.AgentSafetyGuard
import com.vectorbea.worker.net.EstimateCorrection
import com.vectorbea.worker.net.TokenEstimator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The result contract, against the numbers it was built to move.
 *
 * `ObservationSizeReport` measured the BEFORE and asserts it stays true. This
 * measures the AFTER over the same fixtures and the same production code path,
 * so the two are comparable by construction rather than by someone lining up two
 * printouts.
 */
class ResultContractTest {

    private val mapper = ObjectMapper()
    private val guard = AgentSafetyGuard()
    private val estimator = TokenEstimator(EstimateCorrection.none())
    private val cap = 2_000
    private val marker = "… [truncated"

    // ── Fixtures, identical to the baseline report's ─────────────────────────

    private fun crmContact(id: String = "0035g00000AbCdEfGHI"): Map<String, Any?> = linkedMapOf(
        "Id" to id, "IsDeleted" to false, "MasterRecordId" to null,
        "AccountId" to "0015g00000XyZaBcDEF", "LastName" to "Okafor", "FirstName" to "Amara",
        "Salutation" to "Dr.", "Name" to "Dr. Amara Okafor",
        "OtherStreet" to null, "OtherCity" to null, "OtherState" to null,
        "OtherPostalCode" to null, "OtherCountry" to null, "OtherLatitude" to null,
        "OtherLongitude" to null, "OtherGeocodeAccuracy" to null, "OtherAddress" to null,
        "MailingStreet" to "144 Marsh Wall", "MailingCity" to "London", "MailingState" to null,
        "MailingPostalCode" to "E14 9SD", "MailingCountry" to "United Kingdom",
        "MailingLatitude" to 51.4995, "MailingLongitude" to -0.0195,
        "MailingGeocodeAccuracy" to "Address", "Phone" to "+44 20 7946 0812",
        "Fax" to null, "MobilePhone" to "+44 7700 900412", "HomePhone" to null,
        "OtherPhone" to null, "AssistantPhone" to null, "ReportsToId" to null,
        "Email" to "a.okafor@example.com", "Title" to "Director of Operations",
        "Department" to "Operations", "AssistantName" to null, "LeadSource" to "Web",
        "Birthdate" to null,
        "Description" to "Renewal owner for the EMEA account. Prefers email.",
        "OwnerId" to "0055g00000LmNoPqRST", "HasOptedOutOfEmail" to false, "DoNotCall" to false,
        "CreatedDate" to "2023-04-11T09:22:41.000+0000", "CreatedById" to "0055g00000LmNoPqRST",
        "LastModifiedDate" to "2026-08-19T14:03:02.000+0000",
        "LastModifiedById" to "0055g00000LmNoPqRST",
        "SystemModstamp" to "2026-08-19T14:03:02.000+0000", "LastActivityDate" to "2026-08-14",
        "LastCURequestDate" to null, "LastCUUpdateDate" to null,
        "LastViewedDate" to "2026-08-30T08:11:55.000+0000",
        "LastReferencedDate" to "2026-08-30T08:11:55.000+0000",
        "EmailBouncedReason" to null, "EmailBouncedDate" to null, "IsEmailBounced" to false,
        "PhotoUrl" to "/services/images/photo/$id", "Jigsaw" to null, "JigsawContactId" to null,
        "CleanStatus" to "Pending", "IndividualId" to null,
        "attributes" to linkedMapOf("type" to "Contact", "url" to "/services/data/v59.0/x/$id"),
    )

    private fun httpResult(body: Any?, status: Int = 200): Map<String, Any?> = linkedMapOf(
        "statusCode" to status,
        "body" to body,
        "headers" to linkedMapOf(
            "content-type" to "application/json;charset=UTF-8",
            "date" to "Wed, 03 Sep 2026 09:00:00 GMT",
            "server" to "nginx",
            "x-request-id" to "b7c1f0e2-4a2d-4f8e-9c31-2a7d5e0f1b93",
            "sforce-limit-info" to "api-usage=1044/5000000",
            "cache-control" to "no-cache,must-revalidate,max-age=0,no-store,private",
            "strict-transport-security" to "max-age=31536000; includeSubDomains",
            "vary" to "Accept-Encoding"),
    )

    private fun search(n: Int, total: Int = 47): Map<String, Any?> = httpResult(linkedMapOf(
        "totalSize" to total, "done" to false,
        "nextRecordsUrl" to "/services/data/v59.0/query/01g5g00000ABCDEFghi-2000",
        "records" to (1..n).map { crmContact("0035g00000AbCdEf%03d".format(it)) },
    ))

    /** The contract a tool author would write for that CRM search. */
    private val crmContract = ToolResultContract.parse("""
        {
          "version": 1,
          "usage": "Use to find contacts by company or title. For one known contact, use crm.get by id.",
          "collection": {
            "path": "body.records",
            "totalPath": "body.totalSize",
            "sample": 5,
            "moreHint": "Add a narrower `where` clause; this tool does not page."
          },
          "fields": [
            {"path": "body.Id",               "as": "id",      "desc": "Contact record id"},
            {"path": "body.Name",             "as": "name",    "desc": "Full display name"},
            {"path": "body.Email",            "as": "email",   "desc": "Primary email"},
            {"path": "body.Title",            "as": "title",   "desc": "Job title"},
            {"path": "body.AccountId",        "as": "account", "desc": "Owning account id"},
            {"path": "body.MailingCity",      "as": "city",    "desc": "Mailing city"},
            {"path": "body.LastActivityDate", "as": "lastSeen","desc": "Date of last activity"}
          ],
          "errors": [
            {"status": 403, "kind": "auth", "retryable": false,
             "fix": "Reconnect the Salesforce credential in Connections."}
          ]
        }
    """.trimIndent())

    private fun observationOf(result: Map<String, Any?>, contract: ToolResultContract?): String {
        val projected = ResultProjection.project(result, contract)
        return guard.sanitizeToolOutput(projected.json, cap)
    }

    private fun tokensOf(t: String): Long = estimator.estimate(
        "gpt-4o-mini", listOf(mapOf("role" to "user", "content" to t)), 0).rawInputTokens

    // ── ACCEPTANCE ───────────────────────────────────────────────────────────

    /**
     * ACCEPTANCE: median observation tokens fall materially, and truncation on
     * contracted tools drops below 5%.
     *
     * Both halves over the same fixtures the baseline used, so "before" and
     * "after" are the same measurement with one thing changed.
     */
    @Test
    fun `contracted observations are smaller and rarely truncate`() {
        val cases = listOf(
            "CRM search (5 of 47)" to search(5),
            "CRM search (25 of 47)" to search(25),
            "CRM search (47 of 47)" to search(47),
            "CRM single record" to httpResult(crmContact()),
            "CRM search (1 of 1)" to search(1, total = 1),
            "CRM search (empty)" to search(0, total = 0),
        )

        val before = cases.map { (_, r) -> observationOf(r, null) }
        val after = cases.map { (_, r) -> observationOf(r, crmContract) }

        println()
        println("═══ AFTER: the same results, through a result contract ".padEnd(96, '═'))
        println("%-26s %10s %10s %10s %10s".format(
            "case", "before tok", "after tok", "before cut", "after cut"))
        println("─".repeat(96))
        cases.forEachIndexed { i, (name, _) ->
            println("%-26s %10d %10d %10s %10s".format(
                name, tokensOf(before[i]), tokensOf(after[i]),
                if (before[i].contains(marker)) "YES" else "no",
                if (after[i].contains(marker)) "YES" else "no"))
        }
        val medBefore = before.map { tokensOf(it) }.sorted()[before.size / 2]
        val medAfter = after.map { tokensOf(it) }.sorted()[after.size / 2]
        val cutBefore = before.count { it.contains(marker) }
        val cutAfter = after.count { it.contains(marker) }
        println("─".repeat(96))
        println("median tokens: $medBefore → $medAfter " +
                "(${100 - 100 * medAfter / medBefore}% reduction)   " +
                "truncated: $cutBefore/${cases.size} → $cutAfter/${cases.size}")
        println()

        /*
         * ── WHY 40% AND NOT 50% ─────────────────────────────────────────────
         *
         * The measured reduction is 47% (681 → 361 tokens). The bound is set
         * BELOW that on purpose: it is a regression guard, not a target. Tightening
         * it to just under the measured value would mean the next honest change to
         * a fixture fails the build for no defect.
         *
         * And the remaining 361 is not waste — it is five projected records at
         * about seventy tokens each, which is what the contract asked for. Getting
         * under half would mean sampling three records instead of five, and that is
         * the tool author's judgement about their API, not a number to bend so an
         * assertion reads better.
         */
        val reductionPct = 100 - 100 * medAfter / medBefore
        assertTrue(reductionPct >= 40,
            "median observation tokens went $medBefore → $medAfter ($reductionPct%), " +
            "below the 40% this work is expected to hold")
        assertEquals(0, cutAfter,
            "$cutAfter of ${cases.size} contracted observations still truncated — the " +
            "acceptance criterion is under 5%")
        /* And the control: the baseline really was bad, so the improvement is real
           rather than a fixture chosen to flatter it. */
        assertTrue(cutBefore >= cases.size / 2,
            "the uncontracted arm truncated only $cutBefore of ${cases.size}; this " +
            "comparison is not measuring what it claims")
    }

    /**
     * ACCEPTANCE: a contracted observation is valid JSON.
     *
     * The baseline's real damage was not size, it was that every truncated
     * observation was a syntax error. A model given a broken fragment does not
     * receive less information — it receives something it has to guess its way
     * around, which is where the extra iterations go.
     */
    @Test
    fun `a contracted observation always parses`() {
        listOf(search(5), search(47), httpResult(crmContact())).forEach { r ->
            val obs = observationOf(r, crmContract)
            assertTrue(runCatching { mapper.readTree(obs) }.isSuccess,
                "a contracted observation was not valid JSON: ${obs.take(120)}")
        }
    }

    /**
     * A collection says how many there are and how many it is showing.
     *
     * A model handed a cut-off array cannot tell it was cut: it concludes there
     * are five matches when there are forty-seven and answers confidently. The
     * count and the "more" flag cost about twenty tokens and remove that whole
     * class of error.
     */
    @Test
    fun `a collection reports the true total and that more exist`() {
        val obs = mapper.readTree(observationOf(search(25), crmContract))
        assertEquals(47, obs["count"].asInt(), "the count must be the API's total, not the page")
        assertEquals(5, obs["showing"].asInt())
        assertTrue(obs["more"].asBoolean())
        assertTrue(obs["howToGetMore"].asText().contains("where"),
            "the model is told more exist but not how to reach them")
        assertEquals(5, obs["items"].size())
    }

    /**
     * A page with no declared total says so rather than guessing.
     *
     * Reporting the page length as the total would be the same
     * confident-and-wrong failure the summary exists to prevent, just quieter.
     */
    @Test
    fun `an unknown total is stated as unknown`() {
        val noTotal = ToolResultContract.parse("""
            {"collection": {"path": "body.records", "sample": 3},
             "fields": [{"path": "body.Id", "as": "id"}]}
        """.trimIndent())
        val obs = mapper.readTree(observationOf(search(10), noTotal))
        assertEquals(10, obs["count"].asInt())
        assertTrue(obs.has("countIs"),
            "a count derived from one page was presented as the true total")
    }

    /** Projection keeps the fields asked for, under the names asked for. */
    @Test
    fun `projection renames and drops`() {
        val obs = mapper.readTree(observationOf(search(1), crmContract))
        val item = obs["items"][0]
        assertEquals("Dr. Amara Okafor", item["name"].asText())
        assertEquals("a.okafor@example.com", item["email"].asText())
        assertFalse(item.has("SystemModstamp"), "an audit field survived the projection")
        assertFalse(item.has("MailingGeocodeAccuracy"))
        assertEquals(7, item.size(), "the contract declared 7 fields; got ${item.size()}")
    }

    /**
     * A contract that matches nothing falls back to the whole result.
     *
     * The dangerous failure is the quiet one: an API renames a field, the
     * projection produces `{}`, and the model reads that as "the tool found
     * nothing" and acts on it. Returning everything is worse for tokens and much
     * better for correctness.
     */
    @Test
    fun `a contract that matches nothing falls back rather than emptying the result`() {
        val wrong = ToolResultContract.parse("""
            {"fields": [{"path": "body.thisFieldDoesNotExist", "as": "x"}]}
        """.trimIndent())
        val r = httpResult(crmContact())
        val p = ResultProjection.project(r, wrong)
        assertFalse(p.applied, "a projection that found nothing reported success")
        assertTrue(p.json.contains("SystemModstamp"), "the fallback did not return the whole result")
        assertTrue(p.missing.isNotEmpty(), "the missing field was not reported for the log")
    }

    /** No contract is not a degraded contract: the behaviour is byte-identical. */
    @Test
    fun `a tool without a contract is unchanged`() {
        val r = httpResult(crmContact())
        assertEquals(mapper.writeValueAsString(r), ResultProjection.project(r, null).json)
        assertFalse(ResultProjection.project(r, null).applied)
    }

    // ── Error contracts ──────────────────────────────────────────────────────

    /**
     * ACCEPTANCE: an auth error produces an agent that stops rather than retries.
     *
     * Asserted on the OBSERVATION TEXT, because that is the only thing the model
     * sees. A `retryable=false` field nobody renders changes no behaviour.
     */
    @Test
    fun `an auth failure tells the agent not to retry`() {
        val shape = ToolErrorShape.of(crmContract, 403, """{"error":"insufficient scope"}""", null)
        assertEquals("auth", shape.kind)
        assertFalse(shape.retryable)

        val text = shape.asObservation()
        assertTrue(text.contains("NOT help"),
            "the observation does not tell the model retrying is pointless: $text")
        assertTrue(text.contains("Reconnect the Salesforce credential"),
            "the observation does not say what would fix it: $text")
        assertTrue(text.contains("Do not call this tool again"),
            "the model is told not to retry but not what to do instead, which is how " +
            "it ends up retrying with different words: $text")
    }

    /**
     * The HTTP defaults are correct before anyone writes a contract.
     *
     * The error half has to be useful on day one, or it is never adopted.
     */
    @Test
    fun `http status semantics classify correctly with no contract at all`() {
        assertEquals("auth" to false,
            ToolErrorShape.ofStatus(401, null).let { it.kind to it.retryable })
        assertEquals("not_found" to false,
            ToolErrorShape.ofStatus(404, null).let { it.kind to it.retryable })
        assertEquals("invalid_input" to false,
            ToolErrorShape.ofStatus(422, null).let { it.kind to it.retryable })
        assertEquals("rate_limit" to true,
            ToolErrorShape.ofStatus(429, null).let { it.kind to it.retryable })
        assertEquals("server" to true,
            ToolErrorShape.ofStatus(503, null).let { it.kind to it.retryable })
    }

    /**
     * An unrecognised failure is NOT retryable.
     *
     * The asymmetry is deliberate: not retrying something that would have worked
     * costs one opportunity; retrying something that never will costs the whole
     * iteration budget, which is the loop being fixed.
     */
    @Test
    fun `an unknown failure defaults to not retrying`() {
        assertFalse(ToolErrorShape.ofStatus(null, "something went wrong").retryable)
    }

    /** A tool's own rule beats the HTTP default — that is what declaring one is for. */
    @Test
    fun `a tool rule overrides the status default`() {
        val odd = ToolResultContract.parse("""
            {"errors": [{"status": 403, "kind": "rate_limit", "retryable": true,
                         "fix": "This vendor returns 403 when throttled. Wait and retry."}]}
        """.trimIndent())
        val shape = ToolErrorShape.of(odd, 403, null, null)
        assertEquals("rate_limit", shape.kind)
        assertTrue(shape.retryable, "the tool's own rule was ignored in favour of the default")
    }

    // ── Parsing ──────────────────────────────────────────────────────────────

    @Test
    fun `an unreadable contract is null, not a crash`() {
        assertEquals(null, ToolResultContract.parse("{ not json"))
        assertEquals(null, ToolResultContract.parse("{}"))
        assertEquals(null, ToolResultContract.parse(null))
        assertEquals(null, ToolResultContract.parse("null"))
    }

    /**
     * A contract declaring nothing parses to null.
     *
     * Otherwise it would project every result to `{}` — an empty observation that
     * reads exactly like a tool that found no data.
     */
    @Test
    fun `an empty contract is treated as no contract`() {
        assertEquals(null, ToolResultContract.parse("""{"version": 1, "fields": []}"""))
    }

    /** A contract cannot ask for more samples than the budget can hold. */
    @Test
    fun `the sample size is bounded`() {
        val greedy = ToolResultContract.parse("""
            {"collection": {"path": "body.records", "sample": 5000},
             "fields": [{"path": "body.Id", "as": "id"}]}
        """.trimIndent())
        assertNotNull(greedy)
        assertEquals(25, greedy.collection!!.sample,
            "an unbounded sample would reintroduce the problem the contract exists to fix")
    }

    /** The legend is what the model is told about the shape of the answer. */
    @Test
    fun `the field legend names each projected field`() {
        val legend = ResultProjection.legendOf(crmContract)
        assertNotNull(legend)
        assertTrue(legend.contains("email — Primary email"))
        assertTrue(legend.contains("lastSeen — Date of last activity"))
    }

    // ── The summary the Activity view reads ──────────────────────────────────

    /**
     * The observation summary used to describe the ENVELOPE: "Tool returned 3
     * field(s): items, count, nextPage". The projection already computed the
     * counts that describe the ANSWER, and it writes them first so they survive
     * the cap — so the sentence is free.
     *
     * Behind AGENT_RESULT_SUMMARY_ENABLED in the runner; the function itself is
     * unconditional and tested here.
     */
    @Test
    fun `a collection summary reads as a sentence, not as a field list`() {
        val projected = ResultProjection.project(search(5), crmContract)
        assertEquals("Returned 47 results, showing 5.", ResultProjection.summaryOf(projected.json))
    }

    /** Everything that matched is shown — there is no "showing" to report. */
    @Test
    fun `a complete collection does not claim there is more`() {
        val projected = ResultProjection.project(search(5, total = 5), crmContract)
        assertEquals("Returned 5 results.", ResultProjection.summaryOf(projected.json))
    }

    /** Nothing matched. The most consequential result, and the shortest sentence. */
    @Test
    fun `an empty collection says so plainly`() {
        val projected = ResultProjection.project(search(0, total = 0), crmContract)
        assertEquals("Returned no results.", ResultProjection.summaryOf(projected.json))
    }

    /**
     * A contract with no `totalPath` cannot know the total, and the projection
     * says so with `countIs`. Repeating a page size as a total would be the
     * confident-and-wrong failure the whole layer exists to avoid, so the
     * sentence carries the uncertainty rather than dropping it.
     */
    @Test
    fun `an unreported total is summarised as at least, never as exact`() {
        val noTotal = ToolResultContract.parse("""
            {
              "version": 1,
              "collection": {"path": "body.records", "sample": 5},
              "fields": [{"path": "body.Name", "as": "name"}]
            }
        """.trimIndent())
        val projected = ResultProjection.project(search(5), noTotal)
        assertEquals("Returned at least 5 results, showing 5.", ResultProjection.summaryOf(projected.json))
    }

    /**
     * A single record has no count. "Returned 1 result" is a worse sentence than
     * naming the fields it came back with, so the shape summary stands.
     */
    @Test
    fun `a single-record projection has no collection summary`() {
        val oneRecord = ToolResultContract.parse("""
            {
              "version": 1,
              "fields": [
                {"path": "body.Id",   "as": "id"},
                {"path": "body.Name", "as": "name"}
              ]
            }
        """.trimIndent())
        val projected = ResultProjection.project(httpResult(crmContact()), oneRecord)
        assertNull(ResultProjection.summaryOf(projected.json))
    }

    /** A summary is a nicety. It must never take down a tool call that succeeded. */
    @Test
    fun `malformed or countless json summarises to nothing rather than throwing`() {
        assertNull(ResultProjection.summaryOf("not json at all"))
        assertNull(ResultProjection.summaryOf("[1,2,3]"))
        assertNull(ResultProjection.summaryOf("""{"items":[]}"""))
    }
}
