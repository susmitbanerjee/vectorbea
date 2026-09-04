package com.vectorbea.worker.agents.tools

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.agents.brain.runtime.AgentSafetyGuard
import com.vectorbea.worker.net.EstimateCorrection
import com.vectorbea.worker.net.TokenEstimator
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * How big an observation is, and how often the cap breaks it.
 *
 * ── WHAT THIS MEASURES, AND WHAT IT HONESTLY CANNOT ─────────────────────────
 * It runs REAL response shapes through the REAL production path:
 * `HttpNodeExecutor`'s output map (`statusCode` / `body` / `headers`), serialised
 * by Jackson exactly as `renderToolPayload` does, then through
 * `AgentSafetyGuard.sanitizeToolOutput` at the production
 * `MAX_TOOL_PAYLOAD_CHARS`. Nothing here is a model of the code; it is the code.
 *
 * What it is NOT is a sample of production traffic. There is none available: the
 * local database has zero rows in `run_spans(kind='tool_call')`,
 * `agent_iterations` and `run_events(type='TOOL_CALL_COMPLETED')`, and its forty
 * `tools` rows are test fixtures named `gated`. So the RESPONSES are
 * representative fixtures built to the documented shapes of the APIs these tools
 * call — a CRM record, a paged search, a payment object, a row set — and the
 * numbers below are what the cap does to those.
 *
 * The production queries that answer the same questions from real traffic are in
 * `docs/TOOL-RESULT-CONTRACTS.md`. Where a number here is used to justify a
 * decision, the decision is one that holds across the whole size range rather
 * than one tuned to a particular fixture.
 *
 * ── WHY IT IS A TEST AND NOT A SCRIPT ───────────────────────────────────────
 * Because it has to keep being true. It prints a report AND asserts the baseline
 * facts it is quoted for, so the day someone changes the cap, the serialisation
 * or the truncation, the claims in the design document fail rather than quietly
 * becoming wrong.
 */
class ObservationSizeReport {

    private val mapper = ObjectMapper()
    private val guard = AgentSafetyGuard()
    private val estimator = TokenEstimator(EstimateCorrection.none())

    /** Production's cap. Read from the constant so the report cannot drift from it. */
    private val cap = 2_000

    private val truncationMarker = "… [truncated"

    // ── The fixtures ─────────────────────────────────────────────────────────

    /**
     * A CRM contact record: many fields, opaque names, nested objects, nulls.
     *
     * Shaped after a Salesforce/HubSpot contact — the case in the brief. The
     * point is not the exact vendor: it is that the record is wide, most of it is
     * audit and system metadata, and the three fields an agent actually wants are
     * scattered through it.
     */
    private fun crmContact(): Map<String, Any?> = linkedMapOf(
        "Id" to "0035g00000AbCdEfGHI",
        "IsDeleted" to false,
        "MasterRecordId" to null,
        "AccountId" to "0015g00000XyZaBcDEF",
        "LastName" to "Okafor",
        "FirstName" to "Amara",
        "Salutation" to "Dr.",
        "Name" to "Dr. Amara Okafor",
        "OtherStreet" to null, "OtherCity" to null, "OtherState" to null,
        "OtherPostalCode" to null, "OtherCountry" to null,
        "OtherLatitude" to null, "OtherLongitude" to null,
        "OtherGeocodeAccuracy" to null,
        "OtherAddress" to null,
        "MailingStreet" to "144 Marsh Wall",
        "MailingCity" to "London", "MailingState" to null,
        "MailingPostalCode" to "E14 9SD", "MailingCountry" to "United Kingdom",
        "MailingLatitude" to 51.4995, "MailingLongitude" to -0.0195,
        "MailingGeocodeAccuracy" to "Address",
        "Phone" to "+44 20 7946 0812",
        "Fax" to null, "MobilePhone" to "+44 7700 900412", "HomePhone" to null,
        "OtherPhone" to null, "AssistantPhone" to null,
        "ReportsToId" to null,
        "Email" to "a.okafor@example.com",
        "Title" to "Director of Operations",
        "Department" to "Operations",
        "AssistantName" to null,
        "LeadSource" to "Web",
        "Birthdate" to null,
        "Description" to "Renewal owner for the EMEA account. Prefers email.",
        "OwnerId" to "0055g00000LmNoPqRST",
        "HasOptedOutOfEmail" to false,
        "DoNotCall" to false,
        "CreatedDate" to "2023-04-11T09:22:41.000+0000",
        "CreatedById" to "0055g00000LmNoPqRST",
        "LastModifiedDate" to "2026-08-19T14:03:02.000+0000",
        "LastModifiedById" to "0055g00000LmNoPqRST",
        "SystemModstamp" to "2026-08-19T14:03:02.000+0000",
        "LastActivityDate" to "2026-08-14",
        "LastCURequestDate" to null, "LastCUUpdateDate" to null,
        "LastViewedDate" to "2026-08-30T08:11:55.000+0000",
        "LastReferencedDate" to "2026-08-30T08:11:55.000+0000",
        "EmailBouncedReason" to null, "EmailBouncedDate" to null,
        "IsEmailBounced" to false,
        "PhotoUrl" to "/services/images/photo/0035g00000AbCdEfGHI",
        "Jigsaw" to null, "JigsawContactId" to null,
        "CleanStatus" to "Pending",
        "IndividualId" to null,
        "attributes" to linkedMapOf(
            "type" to "Contact",
            "url" to "/services/data/v59.0/sobjects/Contact/0035g00000AbCdEfGHI"),
    )

    /** A search: the envelope a paged API returns, wrapping N of those records. */
    private fun crmSearch(n: Int): Map<String, Any?> = linkedMapOf(
        "totalSize" to 47,
        "done" to false,
        "nextRecordsUrl" to "/services/data/v59.0/query/01g5g00000ABCDEFghi-2000",
        "records" to (1..n).map { i ->
            crmContact().toMutableMap().apply {
                put("Id", "0035g00000AbCdEf%03d".format(i))
                put("Name", "Contact $i")
            }
        },
    )

    /** A payment object: nested, with sub-objects the model never reads. */
    private fun payment(): Map<String, Any?> = linkedMapOf(
        "id" to "pi_3QxYzA2eZvKYlo2C1gFJqM4t",
        "object" to "payment_intent",
        "amount" to 24_900,
        "amount_capturable" to 0,
        "amount_details" to linkedMapOf("tip" to emptyMap<String, Any?>()),
        "amount_received" to 24_900,
        "application" to null, "application_fee_amount" to null,
        "automatic_payment_methods" to linkedMapOf("allow_redirects" to "always", "enabled" to true),
        "canceled_at" to null, "cancellation_reason" to null, "capture_method" to "automatic",
        "client_secret" to "pi_3QxYzA2eZvKYlo2C1gFJqM4t_secret_9xKzQ",
        "confirmation_method" to "automatic",
        "created" to 1_756_800_000,
        "currency" to "gbp",
        "customer" to "cus_QxYzABCDEFGH",
        "description" to "Annual subscription — Growth",
        "invoice" to "in_1QxYzA2eZvKYlo2C",
        "last_payment_error" to null,
        "latest_charge" to "ch_3QxYzA2eZvKYlo2C1abcDEFG",
        "livemode" to true,
        "metadata" to linkedMapOf("workspace_id" to "ws_7781", "plan" to "growth"),
        "next_action" to null, "on_behalf_of" to null,
        "payment_method" to "pm_1QxYzA2eZvKYlo2CabcdEFGH",
        "payment_method_configuration_details" to linkedMapOf(
            "id" to "pmc_1QxYzA2eZvKYlo2C", "parent" to null),
        "payment_method_options" to linkedMapOf(
            "card" to linkedMapOf(
                "installments" to null, "mandate_options" to null,
                "network" to null, "request_three_d_secure" to "automatic"),
            "link" to linkedMapOf("persistent_token" to null)),
        "payment_method_types" to listOf("card", "link"),
        "processing" to null, "receipt_email" to "billing@example.com",
        "review" to null, "setup_future_usage" to null, "shipping" to null,
        "source" to null, "statement_descriptor" to null,
        "statement_descriptor_suffix" to null,
        "status" to "succeeded",
        "transfer_data" to null, "transfer_group" to null,
    )

    /** A SQL row set: the DB tool's shape. */
    private fun rows(n: Int): Map<String, Any?> = linkedMapOf(
        "rowCount" to n,
        "rows" to (1..n).map { i ->
            linkedMapOf(
                "order_id" to "ord_%06d".format(i),
                "customer_id" to "cus_QxYz%04d".format(i),
                "status" to if (i % 3 == 0) "shipped" else "pending",
                "total_cents" to 1000 * i,
                "currency" to "gbp",
                "created_at" to "2026-08-%02dT10:00:00Z".format(1 + i % 28),
                "updated_at" to "2026-08-%02dT12:30:00Z".format(1 + i % 28),
                "notes" to null,
            )
        },
    )

    /** A small, well-designed response. The control: not everything is huge. */
    private fun smallOk(): Map<String, Any?> = linkedMapOf(
        "ok" to true, "id" to "msg_01H8", "sent_at" to "2026-09-03T09:00:00Z")

    // ── The production path, exactly ─────────────────────────────────────────

    /**
     * What the model actually receives for one tool call.
     *
     * `HttpNodeExecutor` returns `{statusCode, body, headers}`; the brain
     * serialises that whole map and caps it. Both halves are reproduced here
     * because BOTH contribute to the size, and the headers in particular are pure
     * noise that nonetheless competes for the budget.
     */
    private fun observationOf(body: Any?): String {
        val output = linkedMapOf<String, Any?>(
            "statusCode" to 200,
            "body" to body,
            "headers" to linkedMapOf(
                "content-type" to "application/json;charset=UTF-8",
                "date" to "Wed, 03 Sep 2026 09:00:00 GMT",
                "server" to "nginx",
                "x-request-id" to "b7c1f0e2-4a2d-4f8e-9c31-2a7d5e0f1b93",
                "sforce-limit-info" to "api-usage=1044/5000000",
                "cache-control" to "no-cache,must-revalidate,max-age=0,no-store,private",
                "strict-transport-security" to "max-age=31536000; includeSubDomains",
                "vary" to "Accept-Encoding",
            ),
        )
        val json = mapper.writeValueAsString(output)
        return guard.sanitizeToolOutput(json, cap)
    }

    private fun tokensOf(text: String): Long =
        estimator.estimate("gpt-4o-mini",
            listOf(mapOf("role" to "user", "content" to text)), 0).rawInputTokens

    private data class Row(
        val name: String, val rawChars: Int, val obsChars: Int,
        val obsTokens: Long, val truncated: Boolean, val validJson: Boolean,
    )

    private fun measure(name: String, body: Any?): Row {
        val raw = mapper.writeValueAsString(
            linkedMapOf("statusCode" to 200, "body" to body, "headers" to emptyMap<String, Any?>()))
        val obs = observationOf(body)
        val truncated = obs.contains(truncationMarker)
        /* Does what the model receives still parse? A truncated JSON fragment is
           not "less information" — it is a syntax error the model has to guess
           its way around. */
        val valid = runCatching { mapper.readTree(obs) }.isSuccess
        return Row(name, raw.length, obs.length, tokensOf(obs), truncated, valid)
    }

    // ── The report ───────────────────────────────────────────────────────────

    @Test
    fun `report observation size and truncation across representative tool results`() {
        val rows = listOf(
            measure("small ack (3 fields)", smallOk()),
            measure("CRM contact (1 record, 56 fields)", crmContact()),
            measure("CRM search (5 of 47)", crmSearch(5)),
            measure("CRM search (25 of 47)", crmSearch(25)),
            measure("payment object (nested)", payment()),
            measure("SQL rows (10)", rows(10)),
            measure("SQL rows (50)", rows(50)),
            measure("SQL rows (200)", rows(200)),
        )

        println()
        println("═══ BEFORE: observation size at MAX_TOOL_PAYLOAD_CHARS=$cap ".padEnd(100, '═'))
        println("%-36s %9s %9s %8s %11s %8s".format(
            "tool result", "raw chars", "obs chars", "tokens", "truncated?", "parses?"))
        println("─".repeat(100))
        rows.forEach {
            println("%-36s %9d %9d %8d %11s %8s".format(
                it.name, it.rawChars, it.obsChars, it.obsTokens,
                if (it.truncated) "YES" else "no",
                if (it.validJson) "yes" else "NO"))
        }
        val truncated = rows.count { it.truncated }
        val broken = rows.count { !it.validJson }
        val medianTokens = rows.map { it.obsTokens }.sorted()[rows.size / 2]
        println("─".repeat(100))
        println("truncated: $truncated/${rows.size}   unparseable after cap: $broken/${rows.size}   " +
                "median observation tokens: $medianTokens")
        println()

        /* ── THE BASELINE FACTS, ASSERTED ───────────────────────────────────
           Quoted in the design document, so they fail rather than rot. */
        assertTrue(rows.filter { it.rawChars > cap }.all { it.truncated },
            "a response larger than the cap was not truncated — the measurement is wrong")
        assertTrue(rows.count { it.truncated } >= rows.size / 2,
            "fewer than half these representative results truncate; the premise that " +
            "truncation is routine does not hold and the priority should change")
        assertTrue(rows.filter { it.truncated }.all { !it.validJson },
            "a truncated observation still parsed as JSON — then the cap is cutting " +
            "cleanly and the 'broken fragment' problem is not real")
    }

    /**
     * Where the budget actually goes on a truncated observation.
     *
     * The breakdown that decides what a projection is worth: if most of the 2000
     * characters were already the fields a model wants, projecting buys little.
     */
    @Test
    fun `report what fills the observation budget`() {
        val body = crmSearch(25)
        val obs = observationOf(body)

        /* The fields an agent asking "who is the renewal owner" actually needs. */
        val wanted = setOf("Id", "Name", "Email", "Title", "Phone", "AccountId",
            "MailingCity", "MailingCountry", "LastActivityDate", "OwnerId")
        val record = crmContact()
        val wantedChars = mapper.writeValueAsString(record.filterKeys { it in wanted }).length
        val wholeRecord = mapper.writeValueAsString(record).length

        val headerChars = mapper.writeValueAsString(linkedMapOf(
            "content-type" to "application/json;charset=UTF-8",
            "date" to "Wed, 03 Sep 2026 09:00:00 GMT",
            "server" to "nginx",
            "x-request-id" to "b7c1f0e2-4a2d-4f8e-9c31-2a7d5e0f1b93",
            "sforce-limit-info" to "api-usage=1044/5000000",
            "cache-control" to "no-cache,must-revalidate,max-age=0,no-store,private",
            "strict-transport-security" to "max-age=31536000; includeSubDomains",
            "vary" to "Accept-Encoding")).length

        println()
        println("═══ WHERE THE BUDGET GOES ".padEnd(100, '═'))
        println("one CRM record, whole:                 $wholeRecord chars")
        println("the ten fields an agent wants:         $wantedChars chars " +
                "(${100 * wantedChars / wholeRecord}% of the record)")
        println("response headers, always included:     $headerChars chars " +
                "(${100 * headerChars / cap}% of the whole observation budget)")
        println("records that fit in the cap:           ~${cap / wholeRecord} of 47 " +
                "(and the last one is cut mid-field)")
        println("records that WOULD fit, projected:     ~${cap / wantedChars} of 47")
        println("observation is truncated:              ${obs.contains(truncationMarker)}")
        println()

        assertTrue(wantedChars * 3 < wholeRecord,
            "the fields an agent wants are already most of the record, so projection " +
            "would not buy much and the design should be reconsidered")
        assertTrue(headerChars > 200,
            "response headers are small enough to ignore; dropping them is not worth doing")
    }
}
