package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.worker.tools.httpspec.HttpAuthSpec

/**
 * Maps a document's `securitySchemes` onto the runtime's auth strategies —
 * item 10.
 *
 * ── THIS IS THE PART THE OLD RESOLVER COULD NOT HAVE DONE ───────────────────
 * Every published document already states exactly how to authenticate: the
 * scheme type, and for an API key, its NAME and whether it goes in a header, a
 * query parameter or a cookie. The old resolver had one hard-coded header name
 * per `auth_type`, so all of that information had nowhere to land — and the
 * single most common published scheme is
 *
 *     type: apiKey, in: header, name: api_key
 *
 * which the old code sent as `x-api-key`, to a service that reads `api_key`.
 * The document was right and unreadable.
 *
 * ── ONE CREDENTIAL PER DOCUMENT, PROMPTED ONCE ──────────────────────────────
 * A spec may declare several schemes and different operations may use different
 * ones. Prompting per operation would make importing forty tools a forty-step
 * credential wizard, so the import picks ONE scheme — the one the most
 * operations actually require — and asks once, at connection level. The
 * alternatives are listed for the person to choose from, because "most
 * operations" is the right default and not always the right answer.
 */
object SecuritySchemeMapper {

    /** One scheme, described for the import UI. */
    data class Candidate(
        val schemeName: String,
        /** How the strategy will be configured. */
        val auth: HttpAuthSpec,
        /** What the person is asked for, in their words. */
        val credentialLabel: String,
        /** Which secret-bundle fields the connection must carry. */
        val requiredSecretFields: List<String>,
        /** How many operations in the document require it. */
        val operationCount: Int,
        /** Present when the scheme is understood but needs a value from the user. */
        val needsInput: List<String> = emptyList(),
        val description: String? = null,
    )

    /**
     * Rank every scheme in the document.
     *
     * Sorted by how many operations require it, so the default is the credential
     * that unlocks the most of the API. Ties break on scheme name, so the same
     * document always produces the same order — a wizard whose default changes
     * between two imports of one file is a wizard nobody trusts.
     */
    fun candidates(doc: OpenApiDocument): List<Candidate> {
        val usage = HashMap<String, Int>()
        doc.operations().forEach { op ->
            op.security.forEach { req -> usage.merge(req.schemeName, 1, Int::plus) }
        }

        return doc.securitySchemes.mapNotNull { (name, raw) ->
            val scheme = doc.resolve(raw)
            toCandidate(name, scheme, usage[name] ?: 0)
        }.sortedWith(compareByDescending<Candidate> { it.operationCount }.thenBy { it.schemeName })
    }

    private fun toCandidate(name: String, scheme: JsonNode, uses: Int): Candidate? =
        when (scheme.get("type")?.asText()?.lowercase()) {
            "apikey" -> apiKey(name, scheme, uses)
            "http" -> http(name, scheme, uses)
            "oauth2" -> oauth2(name, scheme, uses)
            /*
             * OpenID Connect discovery would require fetching the issuer's
             * `.well-known` document — a request to an address the imported
             * document chose, which is the SSRF this importer refuses elsewhere.
             * The scheme is surfaced so the person knows it exists, configured as
             * a bearer token, which is what an OIDC access token is on the wire.
             */
            "openidconnect" -> Candidate(
                schemeName = name,
                auth = HttpAuthSpec.Bearer(),
                credentialLabel = "OpenID Connect access token",
                requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                operationCount = uses,
                needsInput = listOf(
                    "This API uses OpenID Connect. Obtain an access token from your " +
                        "identity provider and paste it, or switch to OAuth2 client " +
                        "credentials and supply the token endpoint."
                ),
                description = scheme.get("description")?.asText(),
            )

            /*
             * `mutualTLS` (OpenAPI 3.1) is not an application credential at all —
             * it is the transport. Surfaced so the import can say so, because the
             * failure otherwise is a certificate error at run time on a tool that
             * imported perfectly.
             */
            "mutualtls" -> Candidate(
                schemeName = name,
                auth = HttpAuthSpec.None,
                credentialLabel = "Client certificate",
                requiredSecretFields = emptyList(),
                operationCount = uses,
                needsInput = listOf(
                    "This API authenticates with a client certificate. Configure mTLS " +
                        "under the tool's transport settings; no API key is needed."
                ),
                description = scheme.get("description")?.asText(),
            )

            else -> null
        }

    private fun apiKey(name: String, scheme: JsonNode, uses: Int): Candidate? {
        val paramName = scheme.get("name")?.asText()?.takeIf { it.isNotBlank() } ?: return null
        return when (scheme.get("in")?.asText()?.lowercase()) {
            "header" -> Candidate(
                schemeName = name,
                /*
                 * The document's own header name. This one line is the fix for the
                 * failure in the brief: a service reading `api_key` was previously
                 * unreachable because the runtime always sent `x-api-key`.
                 */
                auth = HttpAuthSpec.ApiKeyHeader(header = paramName),
                credentialLabel = "API key (sent as the `$paramName` header)",
                requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                operationCount = uses,
                description = scheme.get("description")?.asText(),
            )

            "query" -> Candidate(
                schemeName = name,
                auth = HttpAuthSpec.ApiKeyQuery(param = paramName),
                credentialLabel = "API key (sent as the `$paramName` query parameter)",
                requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                operationCount = uses,
                needsInput = listOf(
                    "This API wants the key in the URL. Every proxy and access log " +
                        "between here and the provider will record it. The runtime " +
                        "keeps it out of our own logs, spans and traces."
                ),
                description = scheme.get("description")?.asText(),
            )

            /*
             * A cookie-borne API key is expressible — an `InputMapping` with a bound
             * constant in the cookie — but not as an AUTH strategy, because the
             * credential would then be stored in the tool rather than the
             * connection. Refused rather than approximated.
             */
            else -> null
        }
    }

    private fun http(name: String, scheme: JsonNode, uses: Int): Candidate? =
        when (scheme.get("scheme")?.asText()?.lowercase()) {
            "bearer" -> Candidate(
                schemeName = name,
                auth = HttpAuthSpec.Bearer(),
                credentialLabel = scheme.get("bearerFormat")?.asText()
                    ?.let { "Bearer token ($it)" } ?: "Bearer token",
                requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                operationCount = uses,
                description = scheme.get("description")?.asText(),
            )

            "basic" -> Candidate(
                schemeName = name,
                auth = HttpAuthSpec.Basic(),
                credentialLabel = "Username and password",
                requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                operationCount = uses,
                needsInput = listOf("Username — it is stored on the tool, not as a secret."),
                description = scheme.get("description")?.asText(),
            )

            /*
             * `digest`, `negotiate` and the rest of the IANA registry. Named rather
             * than silently dropped: a person whose API needs Digest should be told
             * it is unsupported at IMPORT time, not by a 401 three screens later.
             */
            else -> Candidate(
                schemeName = name,
                auth = HttpAuthSpec.Custom(),
                credentialLabel = "Custom `${scheme.get("scheme")?.asText() ?: "http"}` credential",
                requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                operationCount = uses,
                needsInput = listOf(
                    "The `${scheme.get("scheme")?.asText()}` HTTP scheme has no built-in " +
                        "strategy. Configure the header template by hand under Custom auth."
                ),
                description = scheme.get("description")?.asText(),
            )
        }

    /**
     * OAuth2, split by the flow the document declares.
     *
     * ── THE TWO FLOWS ARE DIFFERENT PRODUCTS, NOT DIFFERENT SETTINGS ────────
     * `clientCredentials` is a credential we hold and can mint tokens from
     * forever, so it is configurable end to end from this screen. `authorization
     * Code` is a credential a PERSON grants through a browser; nothing here can
     * obtain the first token, only spend and refresh it. Presenting them
     * identically would produce a connection that saves cleanly and 401s on its
     * first call, with nothing saying why.
     *
     * `implicit` and `password` are deliberately absent. Both are deprecated in
     * OAuth 2.1; `password` would mean storing an end user's password, which is
     * not something this product should offer to do.
     */
    private fun oauth2(name: String, scheme: JsonNode, uses: Int): Candidate? {
        val flows = scheme.get("flows") as? ObjectNode ?: return null

        (flows.get("clientCredentials") as? ObjectNode)?.let { flow ->
            val tokenUrl = flow.get("tokenUrl")?.asText()?.takeIf { it.isNotBlank() }
                ?: return@let
            return Candidate(
                schemeName = name,
                auth = HttpAuthSpec.OAuth2ClientCredentials(
                    tokenUrl = tokenUrl,
                    clientId = "",
                    scopes = scopesOf(flow),
                ),
                credentialLabel = "OAuth2 client id and secret",
                requiredSecretFields = listOf("clientSecret"),
                operationCount = uses,
                needsInput = listOf("Client id", "Client secret"),
                description = scheme.get("description")?.asText(),
            )
        }

        (flows.get("authorizationCode") as? ObjectNode)?.let { flow ->
            val tokenUrl = flow.get("tokenUrl")?.asText()?.takeIf { it.isNotBlank() }
                ?: return@let
            return Candidate(
                schemeName = name,
                auth = HttpAuthSpec.OAuth2AuthorizationCode(
                    tokenUrl = tokenUrl,
                    clientId = "",
                    scopes = scopesOf(flow),
                ),
                credentialLabel = "OAuth2 authorisation (a person signs in)",
                requiredSecretFields = listOf("clientSecret", "refreshToken"),
                operationCount = uses,
                needsInput = listOf(
                    "Client id", "Client secret",
                    "An access token and refresh token, obtained by authorising at " +
                        (flow.get("authorizationUrl")?.asText() ?: "the provider") + ".",
                ),
                description = scheme.get("description")?.asText(),
            )
        }

        return Candidate(
            schemeName = name,
            auth = HttpAuthSpec.Bearer(),
            credentialLabel = "OAuth2 access token",
            requiredSecretFields = listOf(HttpAuthSpec.DEFAULT_SECRET_FIELD),
            operationCount = uses,
            needsInput = listOf(
                "This document declares only deprecated OAuth2 flows (implicit or " +
                    "password). Paste an access token, or ask the provider for a " +
                    "client-credentials or authorization-code endpoint."
            ),
            description = scheme.get("description")?.asText(),
        )
    }

    private fun scopesOf(flow: ObjectNode): List<String> =
        (flow.get("scopes") as? ObjectNode)?.fieldNames()?.asSequence()?.toList() ?: emptyList()
}
