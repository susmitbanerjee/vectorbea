package com.vectorbea.worker.tools.httpspec

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode

/**
 * What one HTTP tool is, declared rather than inferred.
 *
 * ── WHY THE OLD RESOLVER COULD NOT INTEGRATE A REAL SERVICE ─────────────────
 * The previous config was a handful of loose keys — `url`, `method`, `headers`,
 * `body` — read directly by the executor. Four things followed from that, and
 * each of them ruled out a category of API:
 *
 *   · THE BODY WAS AN ACCIDENT. `body` was whatever the tool row happened to
 *     hold, JSON-serialised, with `Content-Type: application/json` hard-coded.
 *     Stripe takes `application/x-www-form-urlencoded`; every file upload takes
 *     multipart. Neither was expressible, so POST worked only against services
 *     that happen to accept JSON.
 *   · AUTH WAS A FIELD, NOT A DECISION. `api_key` meant the header `x-api-key`,
 *     always. A service reading `api_key`, or `X-Api-Token`, or wanting the key
 *     in the query string, could not be called at all — not misconfigured,
 *     unreachable.
 *   · THE AGENT'S VOCABULARY WAS THE WIRE'S. Whatever the model called an
 *     argument was what went on the wire. So a parameter named `starting_after`
 *     had to be described to the model as `starting_after`, and a header
 *     parameter could not be produced from an argument at all.
 *   · THE MODEL SAW THE WHOLE RESPONSE. There was no extraction step, so the
 *     projection layer had nothing upstream shaping what it projected.
 *
 * This type is the fix for all four: every one of them becomes a field that a
 * person can set in the UI, and that an OpenAPI import can fill in correctly
 * without anybody setting anything.
 *
 * ── IT IS VERSIONED WITH THE TOOL, DELIBERATELY ─────────────────────────────
 * [specVersion] is the SHAPE of this document, bumped when the schema changes so
 * an old row still reads. The tool's own version — which agent is granted which
 * behaviour — is a row in `tool_versions`, because an agent's grant must not
 * change underneath it when somebody re-imports a spec. See V064.
 *
 * ── NOTHING SECRET IS EVER IN HERE ──────────────────────────────────────────
 * A spec is stored in `tools.http_spec_json`, returned by the API, rendered in
 * the UI and diffed on re-import. Credentials live on the connection and are
 * referenced by NAME only ([HttpAuthSpec] refers to `secret.<field>`, never to a
 * value). The API rejects a document carrying anything that looks like a
 * credential rather than storing it — see `SpecSecretScan`.
 */
data class HttpToolSpec(
    /** Shape version of this document. Bumped when the schema changes. */
    val specVersion: Int = SPEC_VERSION,
    val request: Request,
    val auth: HttpAuthSpec = HttpAuthSpec.InheritConnection,
    val response: ResponseSpec = ResponseSpec(),
    val pagination: PaginationSpec = PaginationSpec.None,
    val timeoutMs: Long? = null,
    val retry: RetrySpec = RetrySpec(),
    val idempotency: IdempotencySpec = IdempotencySpec(),
    val transport: TransportSpec = TransportSpec(),
) {

    // ── Request ──────────────────────────────────────────────────────────────

    /**
     * The call this tool makes.
     *
     * [path] is joined to the connection's `baseUrl` unless it is absolute.
     * Placeholders are `{name}` (OpenAPI's own spelling) and are filled from the
     * inputs declared `in = path` — never from arbitrary arguments, which is what
     * makes an unmapped placeholder a configuration error rather than a 404 from
     * the vendor six weeks later.
     */
    data class Request(
        val method: String = "GET",
        val path: String = "",
        /** Overrides the connection's baseUrl. Null means "use the connection's". */
        val baseUrl: String? = null,
        val inputs: List<InputMapping> = emptyList(),
        val body: BodySpec = BodySpec.None,
        /** Fixed headers the author set. Auth headers are NOT expressible here. */
        val headers: Map<String, String> = emptyMap(),
        /** Fixed query parameters the author set. */
        val query: Map<String, String> = emptyMap(),
    ) {
        val methodUpper: String get() = method.uppercase()
        val isWrite: Boolean get() = methodUpper !in READ_METHODS
    }

    /**
     * One tool input, and where it lands on the wire.
     *
     * ── THE TWO NAMES ARE THE POINT ─────────────────────────────────────────
     * [name] is what the model is shown and what it puts in its arguments.
     * [wireName] is what the service is sent. They are separate because they
     * answer to different audiences: `cursor` is a good argument name and
     * `starting_after` is what Stripe reads; `repositoryOwner` is legible and
     * `owner` is the path segment. Collapsing them — which is what the old
     * resolver did by having only one — means either the model reads the
     * vendor's abbreviations or the vendor never receives the parameter.
     *
     * [constant] is an input the AUTHOR bound. It is not in the model's schema,
     * cannot be supplied by the model, and is always sent. That is how a tool
     * becomes "list MY organisation's repositories" rather than "list any
     * organisation's repositories", and it is the difference between a tool that
     * is safe to grant and one that is not.
     */
    data class InputMapping(
        val name: String,
        val location: Location,
        /** Wire name. Defaults to [name]. */
        val wireName: String = name,
        val required: Boolean = false,
        /** JSON Schema type: string | number | integer | boolean | array | object. */
        val type: String = "string",
        val description: String? = null,
        /** Used when the model omits an optional input. */
        val default: Any? = null,
        /** Bound by the author; never offered to the model. */
        val constant: Any? = null,
        val enumValues: List<String> = emptyList(),
        /** Serialisation of arrays in query/header. */
        val style: Style = Style.FORM,
        /** `true` sends `a=1&a=2`; `false` sends `a=1,2`. OpenAPI's `explode`. */
        val explode: Boolean = true,
        /**
         * Dotted path INSIDE the body object, for `in = body`. `null` means the
         * value is placed at [wireName] at the top level. `customer.address.line1`
         * builds the nesting. This is what makes a nested JSON body configurable
         * without hand-writing a template.
         */
        val bodyPath: String? = null,
        /**
         * A body input whose value is a file: `{ "filename": ..., "contentType":
         * ..., "content": <base64 or text> }`. Only meaningful for multipart.
         */
        val isFile: Boolean = false,
    ) {
        /** Present in the schema the model is shown. A bound input is not. */
        val isModelFacing: Boolean get() = constant == null

        /** Where in the body this input lands. [wireName] when unset. */
        val effectiveBodyPath: String get() = bodyPath ?: wireName

        enum class Location { PATH, QUERY, HEADER, BODY, COOKIE }
        enum class Style { FORM, SIMPLE, SPACE_DELIMITED, PIPE_DELIMITED, DEEP_OBJECT }
    }

    /**
     * How the request body is built, and what it is labelled as.
     *
     * A `template` is optional and is the escape hatch: most bodies are fully
     * described by the `in = body` inputs and their [InputMapping.bodyPath], and
     * assembling them mechanically is both less to configure and less to get
     * wrong. A template exists for the shapes that are not a flat projection of
     * arguments — an RFC 2822 message, a GraphQL document, an XML envelope.
     */
    sealed interface BodySpec {
        val contentType: String?

        data object None : BodySpec {
            override val contentType: String? get() = null
        }

        /** `application/json`, built from `in = body` inputs, or from [template]. */
        data class Json(
            override val contentType: String = "application/json",
            /** A JSON document with `{{input}}` placeholders. Null = assemble. */
            val template: JsonNode? = null,
        ) : BodySpec

        /** `application/x-www-form-urlencoded`. Stripe, Slack, OAuth token endpoints. */
        data class Form(
            override val contentType: String = "application/x-www-form-urlencoded",
            /**
             * `true` flattens nested objects into Stripe's `a[b][c]=v` bracket
             * form. `false` sends only top-level pairs.
             */
            val bracketNesting: Boolean = true,
        ) : BodySpec

        /** `multipart/form-data`. File uploads. */
        data class Multipart(
            override val contentType: String = "multipart/form-data",
        ) : BodySpec

        /** A single templated string sent verbatim under [contentType]. */
        data class Raw(
            override val contentType: String = "text/plain",
            val template: String = "",
        ) : BodySpec

        /**
         * The value of one input, sent as the whole body.
         *
         * For `application/octet-stream` and for endpoints that take a bare
         * document — a PUT of file content, a POST of an XML payload.
         */
        data class Passthrough(
            override val contentType: String = "application/octet-stream",
            val inputName: String,
        ) : BodySpec
    }

    // ── Response ─────────────────────────────────────────────────────────────

    /**
     * What counts as success, what the agent is shown, and what a failure means.
     *
     * [extract] runs BEFORE the result contract's projection, and the two are
     * built to compose: extraction narrows the DOCUMENT (`$.data`, unwrapping an
     * envelope the model has no use for), the contract narrows the FIELDS within
     * whatever extraction produced. Doing the envelope in the contract would mean
     * writing `body.data.records` in every field path; doing the fields in the
     * extractor would mean a JSONPath per field. Each layer does the job it is
     * shaped for.
     */
    data class ResponseSpec(
        /**
         * Statuses that mean the call worked. Empty means "any 2xx".
         *
         * Declared rather than assumed because it is not always 2xx: an API that
         * answers 404 for "no such record" may be correctly reporting a fact the
         * agent asked for, and an API that answers 200 with `{"ok": false}` has
         * not succeeded. Both are one line here instead of a special case in the
         * executor — the Slack `ok:false` check the old executor hard-coded is
         * now an ordinary [ErrorMapping] on the Slack tool.
         */
        val expectedStatus: List<Int> = emptyList(),
        val extract: Extraction = Extraction.None,
        /** Status/body → the shape an agent can act on. Overrides HTTP defaults. */
        val errors: List<ErrorMapping> = emptyList(),
        /** Response headers to keep. Empty keeps none — models never read them. */
        val keepHeaders: List<String> = emptyList(),
        val maxResponseBytes: Long? = null,
    ) {
        fun accepts(status: Int): Boolean =
            if (expectedStatus.isEmpty()) status in 200..299 else status in expectedStatus
    }

    /**
     * How the agent-visible document is cut out of the response.
     *
     * Two engines because the two communities do not overlap and neither
     * expression translates: JSONPath is what an API's own docs quote, JMESPath
     * is what the AWS CLI and its ecosystem speak. Supporting one would make half
     * of all copied-and-pasted expressions silently wrong rather than rejected.
     */
    sealed interface Extraction {
        data object None : Extraction
        data class JsonPath(val expression: String) : Extraction
        data class JmesPath(val expression: String) : Extraction
    }

    /**
     * One provider error, mapped to the agent-facing contract.
     *
     * Mirrors `ToolResultContract.ErrorRule` deliberately: an HTTP tool's error
     * rules ARE result-contract error rules, and the resolver hands these
     * straight to `ToolErrorShape.of`. Keeping a second vocabulary here would
     * mean an operator learning two ways to say "403 means reconnect".
     */
    data class ErrorMapping(
        val status: Int? = null,
        val bodyContains: String? = null,
        /**
         * Dotted path that matches when the value there is `false` or absent.
         *
         * This is the whole of the Slack special case: `{"ok": false}` arrives as
         * HTTP 200, and the old executor hard-coded a check for it inside the
         * executor — where it applied to every HTTP tool in the product, Slack or
         * not, and could not be turned off.
         */
        val whenBodyFalse: String? = null,
        val kind: String = "unknown",
        val retryable: Boolean = false,
        val fix: String? = null,
        /** Dotted path to the provider's own message, surfaced in the failure. */
        val messagePath: String? = null,
    )

    // ── Pagination ───────────────────────────────────────────────────────────

    /**
     * How, and how far, the resolver follows a paginated collection.
     *
     * ── WHY THIS IS DECLARED AND CAPPED RATHER THAN LEFT TO THE AGENT ───────
     * An agent handed a `next_cursor` will follow it. It has no way to know how
     * many pages there are, and no way to feel the cost of finding out — so the
     * natural behaviour is to keep going until the context window ends the run,
     * having spent the whole budget on a list it will not fit in a prompt.
     *
     * Declaring the strategy moves the loop into the runtime, where a page count
     * is a number and not a judgement call. [maxPages] and [maxItems] are both
     * hard: the first bounds the requests, the second bounds the tokens, and an
     * API with 10-item pages and one with 1000-item pages need different halves
     * of that pair.
     */
    sealed interface PaginationSpec {
        val maxPages: Int
        val maxItems: Int

        /** Path to the array being accumulated across pages. */
        val itemsPath: String?

        data object None : PaginationSpec {
            override val maxPages: Int get() = 1
            override val maxItems: Int get() = Int.MAX_VALUE
            override val itemsPath: String? get() = null
        }

        /** `?cursor=<from the last response>`. Stripe, Slack, Notion. */
        data class Cursor(
            /** Query parameter carrying the cursor on the NEXT request. */
            val cursorParam: String,
            /** Where the next cursor is found in THIS response. */
            val nextCursorPath: String,
            /** Optional boolean path; when false, stop even if a cursor is present. */
            val hasMorePath: String? = null,
            val limitParam: String? = null,
            val pageSize: Int? = null,
            override val itemsPath: String? = null,
            override val maxPages: Int = DEFAULT_MAX_PAGES,
            override val maxItems: Int = DEFAULT_MAX_ITEMS,
        ) : PaginationSpec

        /** `?offset=N&limit=M`, or `?page=N`. */
        data class Offset(
            val offsetParam: String = "offset",
            val limitParam: String? = "limit",
            val pageSize: Int = 50,
            /** `true` counts pages (1,2,3…); `false` counts records (0,50,100…). */
            val pageMode: Boolean = false,
            /** Where the total is, when the API reports one. Stops early. */
            val totalPath: String? = null,
            override val itemsPath: String? = null,
            override val maxPages: Int = DEFAULT_MAX_PAGES,
            override val maxItems: Int = DEFAULT_MAX_ITEMS,
        ) : PaginationSpec

        /** RFC 8288 `Link: <…>; rel="next"`. GitHub, and most of its imitators. */
        data class LinkHeader(
            val relation: String = "next",
            override val itemsPath: String? = null,
            override val maxPages: Int = DEFAULT_MAX_PAGES,
            override val maxItems: Int = DEFAULT_MAX_ITEMS,
        ) : PaginationSpec
    }

    // ── Reliability ──────────────────────────────────────────────────────────

    /**
     * Retry, with jitter, and with a bound that is about the CALLER's budget.
     *
     * Jitter is not a refinement. Without it, every worker that failed against
     * the same provider at the same moment retries at the same moment, and a
     * provider recovering from a blip is immediately knocked over by its own
     * clients — the thundering herd, reproduced exactly by a fixed backoff.
     */
    data class RetrySpec(
        val maxAttempts: Int = 3,
        val initialDelayMs: Long = 250,
        val maxDelayMs: Long = 8_000,
        val multiplier: Double = 2.0,
        val jitter: Jitter = Jitter.FULL,
        /** Statuses worth retrying. Empty uses the default (429 and 5xx). */
        val retryOnStatus: List<Int> = emptyList(),
        /** Honour `Retry-After` when the provider sends one. */
        val respectRetryAfter: Boolean = true,
        /**
         * Retry a NON-IDEMPOTENT method. Default false.
         *
         * A POST that timed out may have been received. Retrying it is how one
         * payment becomes two — so it is off unless the tool also propagates an
         * idempotency key, which is the only thing that makes it safe. The
         * resolver enforces that pairing rather than trusting this flag alone.
         */
        val retryWrites: Boolean = false,
    ) {
        enum class Jitter { NONE, FULL, EQUAL }

        fun retriesStatus(status: Int): Boolean =
            if (retryOnStatus.isEmpty()) status == 429 || status in 500..599
            else status in retryOnStatus
    }

    /**
     * Idempotency key propagation for methods that are not idempotent.
     *
     * The runtime already refuses to REPEAT a call it knows succeeded — that is
     * `SideEffectGuard`, and it is ours. This is the other half: telling the
     * provider, so that a call we could not confirm (a timeout after the request
     * left) is deduplicated on their side too. Stripe, OpenAI and everyone who
     * copied them read `Idempotency-Key`; some read their own header name.
     *
     * The key comes from the side-effect guard, which derives it from
     * `(run, node, attempt_group)` — durable across re-execution by construction.
     * Nothing here may introduce a value that changes between attempts.
     */
    data class IdempotencySpec(
        val mode: Mode = Mode.AUTO,
        val header: String = "Idempotency-Key",
    ) {
        enum class Mode {
            /** Send the header on writes. The default, and what most APIs want. */
            AUTO,

            /** Never send it. For APIs that reject unknown headers. */
            NONE,
        }
    }

    /**
     * Transport, for the networks that are not the open internet.
     *
     * ── WHY THIS IS HERE AND NOT ONLY ON THE CONNECTION ─────────────────────
     * Item 3's OAuth2 and HMAC strategies need it: a client-credentials token
     * endpoint inside a corporate network is reached through the same proxy, and
     * presents the same private CA, as the API it issues tokens for. A transport
     * that lived only beside the API credential would leave the token fetch on
     * the default client, where it fails with a certificate error that names
     * nothing an operator can act on.
     *
     * ── CERTIFICATE MATERIAL IS A REFERENCE, NEVER A VALUE ──────────────────
     * A client key in `http_spec_json` would be a private key in a column that is
     * read by the list endpoint, rendered in the UI and diffed on re-import.
     * Everything secret here is a `secretRef` resolved through `SecretService`;
     * the API's spec validation rejects one that inlines key material. A CA
     * bundle is public by definition and may be inline.
     */
    data class TransportSpec(
        val mtls: Mtls? = null,
        /** PEM, inline. A CA certificate is public material. */
        val caBundlePem: String? = null,
        val proxy: Proxy? = null,
        /** TLS SNI to present, when it differs from the URL's host. */
        val sni: String? = null,
        /** `Host:` header to send, when it differs from the URL's host. */
        val hostHeader: String? = null,
        val tlsProtocols: List<String> = emptyList(),
    ) {
        val isDefault: Boolean
            get() = mtls == null && caBundlePem == null && proxy == null &&
                sni == null && tlsProtocols.isEmpty()

        data class Mtls(
            /** `secretRef` for the client certificate chain, PEM. */
            val clientCertSecretRef: String,
            /** `secretRef` for the private key, PEM (PKCS#8). */
            val clientKeySecretRef: String,
            /** `secretRef` for the key passphrase, when the key is encrypted. */
            val keyPassphraseSecretRef: String? = null,
        )

        data class Proxy(
            val host: String,
            val port: Int,
            val scheme: String = "http",
            /** `secretRef` for `user:password`, when the proxy authenticates. */
            val credentialSecretRef: String? = null,
        )
    }

    // ── Serialisation ────────────────────────────────────────────────────────

    fun toJson(): ObjectNode = HttpToolSpecJson.write(this)

    fun toJsonString(): String = MAPPER.writeValueAsString(toJson())

    companion object {
        const val SPEC_VERSION = 1
        const val DEFAULT_MAX_PAGES = 5
        const val DEFAULT_MAX_ITEMS = 200

        val READ_METHODS = setOf("GET", "HEAD", "OPTIONS", "TRACE")
        val ALL_METHODS = setOf("GET", "HEAD", "OPTIONS", "TRACE", "POST", "PUT", "PATCH", "DELETE")

        internal val MAPPER = ObjectMapper()

        /**
         * Parse a stored spec.
         *
         * Returns null — never throws, never a half-parsed object — for a
         * document that is absent, unreadable, or of a shape version this build
         * does not know. The caller falls back to the legacy config keys, so a
         * tool written before this existed keeps working unchanged, and a tool
         * written by a NEWER build is refused rather than executed with fields
         * silently dropped. Executing three quarters of a spec is how a tool
         * quietly stops sending its auth header.
         */
        fun parse(json: String?): HttpToolSpec? = HttpToolSpecJson.read(json)

        fun parse(node: JsonNode?): HttpToolSpec? = HttpToolSpecJson.read(node)
    }
}
