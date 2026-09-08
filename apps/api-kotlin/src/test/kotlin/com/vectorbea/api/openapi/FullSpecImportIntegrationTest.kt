package com.vectorbea.api.openapi

import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The importer against the vendors' documents WHOLE, over the network.
 *
 * ── WHY THIS EXISTS BESIDE `RealSpecImportTest` ─────────────────────────────
 * That suite uses verbatim excerpts, trimmed to a handful of operations and
 * their `$ref` closure, because GitHub's document is 12 MB and Stripe's is 8 MB
 * and a 20 MB fixture directory is a repository nobody wants to clone.
 *
 * Trimming removes exactly the things that break a parser at scale: nine hundred
 * operations rather than six, `$ref` chains that run deeper than any excerpt
 * keeps, schemas that refer to themselves through three intermediaries, and
 * enough total nesting to exercise the depth bounds. So the trimmed suite proves
 * the mapping is CORRECT and this one proves it SURVIVES.
 *
 * ── TAGGED `integration`, AND SKIPPED RATHER THAN FAILED ────────────────────
 * `./gradlew test` excludes this tag; `./gradlew integrationTest` runs it. It
 * also skips itself when the network is unreachable, which is the one case where
 * a skip is honest: a laptop on a train has not discovered a bug in the importer.
 *
 * That is a deliberate exception to this repository's usual rule — `assumeTrue`
 * as a substitute for infrastructure is how five acceptance criteria once
 * accumulated behind a skip nobody noticed. It is acceptable HERE only because
 * the behaviour is fully covered offline by `RealSpecImportTest`, and this suite
 * adds scale rather than correctness.
 */
@Tag("integration")
class FullSpecImportIntegrationTest {

    private val client: HttpClient = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(15))
        .build()

    private fun fetch(url: String): ByteArray? = try {
        val response = client.send(
            HttpRequest.newBuilder().uri(URI.create(url))
                .timeout(Duration.ofMinutes(2)).GET().build(),
            HttpResponse.BodyHandlers.ofByteArray(),
        )
        if (response.statusCode() in 200..299) response.body() else null
    } catch (_: Exception) {
        null
    }

    /**
     * Import a whole document and assert the properties that only break at scale.
     *
     * Deliberately NOT asserting anything about specific operations: those are
     * `RealSpecImportTest`'s job, against pinned fixtures, and asserting them
     * here would make this suite fail whenever a vendor edits their API — which
     * is a fact about the vendor, not a regression in the importer.
     */
    private fun importWhole(name: String, url: String, minOperations: Int) {
        val bytes = fetch(url)
        assumeTrue(bytes != null, "$name is unreachable; skipping the at-scale check")

        val read = OpenApiReader.read(bytes!!)
        val doc = OpenApiDocument.of(read.root)
        val operations = doc.operations()

        /*
         * A floor per document, well under what each really publishes, because
         * the point is "the walk did not stop early" and not "the vendor has not
         * changed their API". Petstore has about nineteen operations and the
         * others have hundreds; one threshold cannot serve both, and a shared one
         * low enough for Petstore would prove nothing about GitHub.
         */
        assertTrue(
            operations.size >= minOperations,
            "$name produced only ${operations.size} operations, under the floor of " +
                "$minOperations — the walk stopped early rather than the vendor shrinking " +
                "their API",
        )

        val auth = SecuritySchemeMapper.candidates(doc).firstOrNull()?.auth ?: HttpAuthSpec.None
        val baseUrl = doc.baseUrl()

        var mapped = 0
        var withBody = 0
        var paginated = 0
        var contracted = 0

        for (op in operations) {
            val generated = try {
                OperationMapper.map(doc, op, auth, baseUrl)
            } catch (e: Exception) {
                fail("$name / ${op.key} (${op.method} ${op.path}) failed to map: $e")
            }
            mapped++

            /* Every generated document must be readable by the WORKER's reader.
               A spec the API can write and the worker cannot read is a tool that
               saves cleanly and fails on its first run. */
            val json = generated.spec.toJsonString()
            HttpToolSpec.parse(json)
                ?: fail("$name / ${op.key}: the generated spec did not parse back")

            /* And it must never carry a credential — the import-time half of the
               guarantee that a secret reaches no span, event, log or trace. */
            SpecSecretScan.findInlineSecret(generated.spec.toJson())?.let {
                fail("$name / ${op.key}: the generated spec carries $it")
            }

            /* Every path placeholder is supplied. At this scale it is the check
               that catches a document shape the parameter merge does not handle —
               GitHub declares `owner` and `repo` at the PATH level, for hundreds
               of operations, and missing that produces URLs with `{owner}` in
               them and a vendor 404 that names nothing. */
            val placeholders = Regex("""\{([^}]+)}""")
                .findAll(generated.spec.request.path).map { it.groupValues[1] }.toSet()
            val supplied = generated.spec.request.inputs
                .filter { it.location == HttpToolSpec.InputMapping.Location.PATH }
                .map { it.wireName }.toSet()
            assertTrue(
                placeholders.all { it in supplied },
                "$name / ${op.key}: the path needs ${placeholders - supplied} and no input " +
                    "supplies it",
            )

            /* Bounds hold on every operation, not just the sampled ones. An
               unbounded page walk is the failure the strategy exists to prevent. */
            assertTrue(
                generated.spec.pagination.maxPages in 1..50,
                "$name / ${op.key}: unbounded page walk",
            )
            assertTrue(
                (generated.resultContract?.get("fields")?.size() ?: 0) <= 10,
                "$name / ${op.key}: the result contract is as wide as the response",
            )
            assertTrue(
                generated.description.length <= 600,
                "$name / ${op.key}: a ${generated.description.length}-character description " +
                    "is paid for on every agent iteration",
            )

            if (generated.spec.request.body !is HttpToolSpec.BodySpec.None) withBody++
            if (generated.spec.pagination !is HttpToolSpec.PaginationSpec.None) paginated++
            if (generated.resultContract != null) contracted++
        }

        println(
            "[$name] ${read.byteCount / 1024} KB ${read.format}, $mapped operations mapped: " +
                "$withBody with a body, $paginated paginated, $contracted with a result contract"
        )

        /* A document this size that produced no bodies, no pagination and no
           contracts parsed but learned nothing — which is what a silently
           half-working mapper looks like, and is invisible to a per-operation
           assertion. */
        assertTrue(withBody > 0, "$name produced no request bodies at all")
        assertTrue(contracted > 0, "$name produced no result contracts at all")
    }

    @Test
    fun `github, whole`() = importWhole(
        "GitHub",
        "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/" +
            "api.github.com/api.github.com.json",
        minOperations = 500,
    )

    @Test
    fun `stripe, whole`() = importWhole(
        "Stripe",
        "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
        minOperations = 300,
    )

    @Test
    fun `petstore, whole, as YAML`() = importWhole(
        "Petstore",
        "https://petstore3.swagger.io/api/v3/openapi.yaml",
        /* Small on purpose: it is here for the YAML path on a WHOLE document,
           not for scale. */
        minOperations = 15,
    )

    @Test
    fun `twilio, whole`() = importWhole(
        "Twilio",
        "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
        minOperations = 100,
    )
}
