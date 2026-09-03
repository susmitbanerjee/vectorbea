package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.agents.brain.runtime.AgentSafetyGuard
import com.vectorbea.worker.testsupport.ScriptedLlmProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Iterations-to-completion — the number that actually matters.
 *
 * Fewer iterations is less cost, less latency and less rate-limit pressure, and
 * it is the only one of the four acceptance criteria that measures the thing the
 * others are proxies for.
 *
 * ── HOW A MODEL IS SIMULATED HERE, AND WHY IT IS CONSERVATIVE ───────────────
 * A fixed script cannot measure this. It produces the same iteration count
 * whether the observation held the answer or a broken JSON fragment, because the
 * script decided in advance — so the responder has to READ the observation and
 * react, which is exactly the behaviour under test.
 *
 * The simulated agent here is deliberately *generous* to the uncontracted arm:
 * it answers as soon as the value it is looking for is present and parseable in
 * an observation, and asks again when it is not. A real model does worse than
 * that — it is also distracted by noise it *can* parse, misreads opaque field
 * names, and sometimes answers wrongly from a truncated fragment rather than
 * retrying. So the improvement measured here is a LOWER BOUND.
 *
 * What it does not simulate, and what nothing here claims to: whether a real
 * model's answer is correct. That needs an eval harness and real models. This
 * measures the mechanism — is the answer present, in a form that can be read —
 * which is the part that is a tool design problem.
 */
class IterationsToCompletionTest {

    private val mapper = ObjectMapper()
    private val guard = AgentSafetyGuard()
    private val cap = 2_000

    // ── The world the agent is working in ────────────────────────────────────

    private fun contact(i: Int, title: String): Map<String, Any?> = linkedMapOf(
        "Id" to "0035g00000AbCdEf%03d".format(i),
        "IsDeleted" to false, "MasterRecordId" to null,
        "AccountId" to "0015g00000XyZaBcDEF",
        "LastName" to "Person$i", "FirstName" to "Test", "Salutation" to "Dr.",
        "Name" to "Test Person$i",
        "OtherStreet" to null, "OtherCity" to null, "OtherState" to null,
        "OtherPostalCode" to null, "OtherCountry" to null, "OtherLatitude" to null,
        "OtherLongitude" to null, "OtherGeocodeAccuracy" to null, "OtherAddress" to null,
        "MailingStreet" to "144 Marsh Wall", "MailingCity" to "London",
        "MailingState" to null, "MailingPostalCode" to "E14 9SD",
        "MailingCountry" to "United Kingdom", "MailingLatitude" to 51.4995,
        "MailingLongitude" to -0.0195, "MailingGeocodeAccuracy" to "Address",
        "Phone" to "+44 20 7946 0812", "Fax" to null,
        "MobilePhone" to "+44 7700 900412", "HomePhone" to null, "OtherPhone" to null,
        "AssistantPhone" to null, "ReportsToId" to null,
        "Email" to "person$i@example.com",
        "Title" to title, "Department" to "Operations", "AssistantName" to null,
        "LeadSource" to "Web", "Birthdate" to null,
        "Description" to "Renewal owner for the EMEA account. Prefers email.",
        "OwnerId" to "0055g00000LmNoPqRST", "HasOptedOutOfEmail" to false,
        "DoNotCall" to false, "CreatedDate" to "2023-04-11T09:22:41.000+0000",
        "CreatedById" to "0055g00000LmNoPqRST",
        "LastModifiedDate" to "2026-08-19T14:03:02.000+0000",
        "LastModifiedById" to "0055g00000LmNoPqRST",
        "SystemModstamp" to "2026-08-19T14:03:02.000+0000",
        "LastActivityDate" to "2026-08-14", "LastCURequestDate" to null,
        "LastCUUpdateDate" to null, "LastViewedDate" to "2026-08-30T08:11:55.000+0000",
        "LastReferencedDate" to "2026-08-30T08:11:55.000+0000",
        "EmailBouncedReason" to null, "EmailBouncedDate" to null,
        "IsEmailBounced" to false, "PhotoUrl" to "/services/images/photo/x$i",
        "Jigsaw" to null, "JigsawContactId" to null, "CleanStatus" to "Pending",
        "IndividualId" to null,
    )

    /**
     * The target is the FOURTH record, not the first.
     *
     * With a raw response the cap admits roughly one record, so the answer is past
     * the cut — which is the case the brief describes and the one a contract has
     * to fix. Putting it first would make both arms succeed immediately and
     * measure nothing.
     */
    private fun searchResult(): Map<String, Any?> = linkedMapOf(
        "statusCode" to 200,
        "body" to linkedMapOf(
            "totalSize" to 12, "done" to true,
            "records" to (1..12).map {
                contact(it, if (it == 4) "Director of Operations" else "Analyst")
            }),
        "headers" to linkedMapOf(
            "content-type" to "application/json;charset=UTF-8",
            "x-request-id" to "b7c1f0e2-4a2d-4f8e-9c31-2a7d5e0f1b93",
            "cache-control" to "no-cache,must-revalidate,max-age=0,no-store,private"),
    )

    private val contract = ToolResultContract.parse("""
        {
          "collection": {"path": "body.records", "totalPath": "body.totalSize", "sample": 12},
          "fields": [
            {"path": "body.Name",  "as": "name",  "desc": "Full name"},
            {"path": "body.Email", "as": "email", "desc": "Primary email"},
            {"path": "body.Title", "as": "title", "desc": "Job title"}
          ]
        }
    """.trimIndent())

    private fun observation(withContract: Boolean): String {
        val p = ResultProjection.project(searchResult(), if (withContract) contract else null)
        return guard.sanitizeToolOutput(p.json, cap)
    }

    // ── The simulated agent ──────────────────────────────────────────────────

    /**
     * Answer when the observation demonstrably contains the target's email.
     *
     * "Demonstrably" is doing real work: the observation must PARSE and the
     * director's record must be findable in it. A truncated fragment fails both,
     * so the agent asks again — which is what a model does when it cannot read
     * what it was given, and is the behaviour the brief describes as the signal
     * that the tool did not deliver.
     */
    private fun canAnswer(prompt: String): Boolean {
        val start = prompt.indexOf("{\"count\"").takeIf { it >= 0 }
            ?: prompt.indexOf("{\"statusCode\"").takeIf { it >= 0 }
            ?: return false
        val text = prompt.substring(start)
        val end = text.lastIndexOf('}')
        if (end <= 0) return false
        val json = runCatching { mapper.readTree(text.substring(0, end + 1)) }.getOrNull()
            ?: return false
        return json.toString().contains("Director of Operations") &&
               json.toString().contains("person4@example.com")
    }

    /** Run the loop and return how many model calls it took to answer. */
    private fun iterationsToAnswer(withContract: Boolean, ceiling: Int = 8): Int {
        val obs = observation(withContract)
        var calls = 0
        var answered = -1
        /* The loop, as the brain runs it: prompt, act, observe, repeat. Modelled
           rather than driven through AgentBrainRunner because the brain needs a
           live tool executor and a database, and what is being measured — how many
           times the model asks before it can answer — is a property of the
           observation, not of the persistence around it. */
        val transcript = StringBuilder("TASK: find the email of the Director of Operations.\n")
        while (calls < ceiling) {
            calls++
            if (canAnswer(transcript.toString())) { answered = calls; break }
            // The model calls the tool; the runtime appends the observation.
            transcript.append("\nOBSERVATION ").append(calls).append(":\n").append(obs).append('\n')
        }
        return if (answered > 0) answered else ceiling
    }

    // ── ACCEPTANCE ───────────────────────────────────────────────────────────

    @Test
    fun `a contract reduces iterations to completion`() {
        val without = iterationsToAnswer(withContract = false)
        val with = iterationsToAnswer(withContract = true)

        println()
        println("═══ ITERATIONS TO COMPLETION ".padEnd(80, '═'))
        println("task: find the email of the Director of Operations (record 4 of 12)")
        println("  without a result contract: $without model call(s)" +
                if (without >= 8) "  — never answered, hit the ceiling" else "")
        println("  with a result contract:    $with model call(s)")
        println("  observation, uncontracted: ${observation(false).length} chars, " +
                "parses=${runCatching { mapper.readTree(observation(false)) }.isSuccess}")
        println("  observation, contracted:   ${observation(true).length} chars, " +
                "parses=${runCatching { mapper.readTree(observation(true)) }.isSuccess}")
        println()

        assertTrue(with < without,
            "iterations did not fall: $without → $with")
        assertEquals(2, with,
            "with a contract the agent should ask once and answer on the next turn; " +
            "took $with")
        /* The control: the uncontracted arm must genuinely fail, or the comparison
           is between two successes and proves nothing. */
        assertTrue(without >= 8,
            "the uncontracted arm answered in $without calls, so the truncated " +
            "observation was readable after all and this test measures nothing")
    }

    /**
     * And the reason is the truncation, not the size.
     *
     * Stated separately because the two are easy to conflate: a smaller
     * observation that was still a broken fragment would not help at all.
     */
    @Test
    fun `the uncontracted observation is unreadable, not merely large`() {
        val raw = observation(false)
        assertTrue(raw.contains("… [truncated"), "the uncontracted arm was not truncated")
        assertTrue(runCatching { mapper.readTree(raw) }.isFailure,
            "the uncontracted observation parsed, so the failure being measured is " +
            "not the one described")
        assertTrue(runCatching { mapper.readTree(observation(true)) }.isSuccess,
            "the contracted observation did not parse")
    }

    /**
     * ACCEPTANCE: an auth error stops the agent rather than starting a retry loop.
     *
     * Driven through the same simulated agent, because the criterion is about
     * BEHAVIOUR: an agent that reads "retrying will not help" and calls the tool
     * again has not been helped by a better message.
     */
    @Test
    fun `an auth error stops the agent instead of looping`() {
        val authObs = ToolErrorShape.ofStatus(403, null).asObservation()
        val vagueObs = "Tool 7f3a-… failed: HTTP 403"

        /* The simulated agent's rule, and the only one it has: stop when told the
           failure is not retryable AND told what to do instead. */
        fun stops(observation: String): Boolean =
            observation.contains("NOT help") && observation.contains("Do not call this tool again")

        assertTrue(stops(authObs),
            "the contracted auth observation does not tell the agent to stop: $authObs")
        assertTrue(!stops(vagueObs),
            "the control message would also have stopped the agent, so the contract " +
            "is not what made the difference")

        var calls = 0
        while (calls < 8 && !stops(if (calls == 0) "" else authObs)) calls++
        assertEquals(1, calls,
            "the agent kept calling a tool that had told it retrying would not help")
    }
}
