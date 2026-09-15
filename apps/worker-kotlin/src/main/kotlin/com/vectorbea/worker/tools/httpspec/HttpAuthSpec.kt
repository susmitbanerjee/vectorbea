package com.vectorbea.worker.tools.httpspec

/**
 * How this tool authenticates — a strategy, not a field.
 *
 * ── WHAT WAS WRONG WITH A FIELD ─────────────────────────────────────────────
 * The connection carried `auth_type`, and the executor turned it into exactly
 * one header each:
 *
 *     "api_key"       -> "x-api-key" to secret
 *     "bearer", "jwt" -> "Authorization" to "Bearer $secret"
 *     "basic"         -> "Authorization" to "Basic $encoded"
 *     else            -> "Authorization" to "Bearer $secret"
 *
 * Every name in that table is a decision the SERVICE makes, taken here on its
 * behalf. A service reading `api_key` — which is the header name in a large
 * fraction of published OpenAPI documents, and the one named in the brief —
 * received nothing, and the failure surfaced as a 401 whose text blamed the
 * credential. The `else` branch is worse: an unknown auth type silently became
 * a bearer token, so a misconfiguration was indistinguishable from a bad key.
 *
 * Making this a sealed hierarchy means an unsupported scheme cannot be guessed
 * at. It either parses to a strategy that names what it will send, or the spec
 * does not parse.
 *
 * ── WHERE THE CREDENTIAL COMES FROM, ALWAYS ─────────────────────────────────
 * Nothing here holds a secret. Every strategy names FIELDS of the connection's
 * secret bundle — `secret.apiKey`, `secret.clientSecret` — and the resolver
 * looks them up through `SecretService` at call time. A spec is stored in a
 * JSONB column, returned by the list endpoint, rendered in a form and diffed on
 * re-import; a credential in it would be a credential in all four.
 *
 * The corollary is enforced at the other end too: the rendered value never
 * reaches a span, an event, a log line or an exported trace. See `SecretScope`.
 */
sealed interface HttpAuthSpec {

    /** A stable discriminator, used by the UI and by the stored document. */
    val strategy: String

    /**
     * Use whatever the connection's `auth_type` says.
     *
     * The default, and the migration path: every tool that exists today gets
     * this and behaves as it did. It maps the legacy `auth_type` values onto the
     * strategies below — including `api_key` onto `x-api-key`, because changing
     * where an existing tool sends its key would be a silent breaking change to
     * a working integration.
     */
    data object InheritConnection : HttpAuthSpec {
        override val strategy: String get() = "inherit"
    }

    /** No credential is sent. Public endpoints, and internal ones behind mTLS. */
    data object None : HttpAuthSpec {
        override val strategy: String get() = "none"
    }

    /**
     * A key in a named header.
     *
     * [header] is configurable because it is not standard: `X-API-Key`,
     * `api_key`, `apikey`, `X-Auth-Token`, `Authorization` with a custom scheme —
     * all of these are in production APIs today.
     */
    data class ApiKeyHeader(
        val header: String = "X-API-Key",
        /** Written before the key, with a space. `""` sends the bare key. */
        val prefix: String = "",
        /** Field of the connection's secret bundle holding the key. */
        val secretField: String = DEFAULT_SECRET_FIELD,
    ) : HttpAuthSpec {
        override val strategy: String get() = "api_key_header"
    }

    /**
     * A key in a named query parameter.
     *
     * ── AND WHY IT IS TREATED AS A HAZARD ───────────────────────────────────
     * A query string is logged by every proxy it passes, ends up in the
     * provider's own access logs, and is the one place a credential leaks
     * without anybody making a mistake. The resolver therefore never writes a
     * URL containing this parameter to an event, a span or a log line — the
     * sanitiser drops the query entirely on the path where this strategy is in
     * use. It is supported because real APIs require it, not because it is fine.
     */
    data class ApiKeyQuery(
        val param: String = "api_key",
        val secretField: String = DEFAULT_SECRET_FIELD,
    ) : HttpAuthSpec {
        override val strategy: String get() = "api_key_query"
    }

    /** `Authorization: Bearer <token>`, with both parts configurable. */
    data class Bearer(
        val header: String = "Authorization",
        val prefix: String = "Bearer",
        val secretField: String = DEFAULT_SECRET_FIELD,
    ) : HttpAuthSpec {
        override val strategy: String get() = "bearer"
    }

    /**
     * `Authorization: Basic base64(user:password)`.
     *
     * [username] is not a secret and is stored here; the password comes from the
     * secret bundle. Some services put the credential entirely in the username
     * and want an empty password — Stripe's legacy basic mode does — so
     * [passwordSecretField] may be blank.
     */
    data class Basic(
        val username: String = "",
        val passwordSecretField: String = DEFAULT_SECRET_FIELD,
        /** Read the username from the secret bundle instead of [username]. */
        val usernameSecretField: String? = null,
        val header: String = "Authorization",
    ) : HttpAuthSpec {
        override val strategy: String get() = "basic"
    }

    /**
     * OAuth2 client credentials — a machine-to-machine grant.
     *
     * ── THE TOKEN IS CACHED, AND THAT IS THE INTERESTING PART ───────────────
     * Fetching a token per call would triple the request count and would rate-
     * limit the token endpoint long before the API. Caching it means holding a
     * live credential in memory, keyed by something that cannot collide across
     * tenants — so the cache key is (workspace, connection, scopes, audience)
     * and never the tool, because two tools on one connection share a token by
     * design and must not each hold their own.
     *
     * [expirySkewSeconds] exists because `expires_in` is measured at the
     * provider and consumed here, across a network and two clocks. Refreshing at
     * exactly the expiry produces a steady trickle of 401s on calls that started
     * a second too late.
     */
    data class OAuth2ClientCredentials(
        val tokenUrl: String,
        /** Client id is not a secret; it identifies, it does not authenticate. */
        val clientId: String,
        val clientSecretField: String = "clientSecret",
        val scopes: List<String> = emptyList(),
        val audience: String? = null,
        /** Where the client credentials go on the token request. */
        val clientAuth: ClientAuth = ClientAuth.BASIC_HEADER,
        val header: String = "Authorization",
        val prefix: String = "Bearer",
        val expirySkewSeconds: Long = 60,
        /** Extra form fields some providers require (`resource`, `tenant`…). */
        val extraParams: Map<String, String> = emptyMap(),
    ) : HttpAuthSpec {
        override val strategy: String get() = "oauth2_client_credentials"

        enum class ClientAuth {
            /** RFC 6749 §2.3.1 preferred form: `Authorization: Basic`. */
            BASIC_HEADER,

            /** `client_id` and `client_secret` as form fields. Widely required. */
            BODY,
        }
    }

    /**
     * OAuth2 authorization code — a credential delegated by a USER.
     *
     * ── WHY IT IS A DIFFERENT STRATEGY AND NOT A FLAG ───────────────────────
     * The token is not derivable from anything we hold. It was granted through a
     * browser redirect to a person, and what is stored is the result: an access
     * token that expires, and a refresh token that mints new ones. The runtime
     * cannot obtain the first one — it can only spend it and refresh it — so the
     * failure mode when the refresh token is revoked is "a human must reconnect",
     * which is a different sentence to the agent than "retry later". That
     * distinction is why this is its own strategy.
     *
     * The refreshed access token is written back to the connection's secret so
     * the next run does not start by refreshing again.
     */
    data class OAuth2AuthorizationCode(
        val tokenUrl: String,
        val clientId: String,
        val clientSecretField: String = "clientSecret",
        val accessTokenField: String = "accessToken",
        val refreshTokenField: String = "refreshToken",
        /** Where the expiry is kept in the bundle, as epoch seconds. */
        val expiresAtField: String = "expiresAt",
        val scopes: List<String> = emptyList(),
        val clientAuth: OAuth2ClientCredentials.ClientAuth = OAuth2ClientCredentials.ClientAuth.BODY,
        val header: String = "Authorization",
        val prefix: String = "Bearer",
        val expirySkewSeconds: Long = 60,
    ) : HttpAuthSpec {
        override val strategy: String get() = "oauth2_authorization_code"
    }

    /**
     * HMAC request signing.
     *
     * ── WHY THE CANONICAL STRING IS A TEMPLATE ──────────────────────────────
     * There is no standard. AWS SigV4, Shopify, Twilio, Coinbase and every bank
     * integration each concatenate a different set of request facts in a
     * different order with a different separator. A fixed canonical form would
     * support exactly one of them, so what is configurable is the string itself,
     * built from a small vocabulary the resolver supplies:
     *
     *     {{method}} {{path}} {{query}} {{timestamp}} {{nonce}}
     *     {{body}}   {{bodySha256Hex}}  {{bodySha256Base64}}  {{host}}
     *
     * [signatureHeader] receives the digest. [timestampHeader] and [nonceHeader]
     * receive the values that went into it, when the service expects them —
     * omitting one of those is the usual cause of a signature that verifies
     * locally and is rejected remotely.
     */
    data class Hmac(
        val algorithm: String = "HmacSHA256",
        val secretField: String = DEFAULT_SECRET_FIELD,
        val canonicalTemplate: String = "{{method}}\n{{path}}\n{{timestamp}}\n{{bodySha256Hex}}",
        val signatureHeader: String = "X-Signature",
        /** Written before the digest, with a space. e.g. `HMAC-SHA256`. */
        val signaturePrefix: String = "",
        val encoding: Encoding = Encoding.HEX,
        val timestampHeader: String? = "X-Timestamp",
        /** `seconds` or `milliseconds`. */
        val timestampUnit: TimestampUnit = TimestampUnit.SECONDS,
        val nonceHeader: String? = null,
        /** A non-secret key identifier some schemes send alongside the digest. */
        val keyId: String? = null,
        val keyIdHeader: String? = null,
    ) : HttpAuthSpec {
        override val strategy: String get() = "hmac"

        enum class Encoding { HEX, BASE64, BASE64_URL }
        enum class TimestampUnit { SECONDS, MILLISECONDS }
    }

    /**
     * The escape hatch: templated headers and query parameters.
     *
     * ── WHAT IT MAY REFER TO, AND WHAT IT MAY NOT ───────────────────────────
     * Templates here see `{{secret.<field>}}` and nothing else — not the agent's
     * arguments, not the request body, not the environment. That is deliberate:
     * this is the auth layer, and an auth header built from a model-supplied
     * value is a header the model controls. Everything the agent can influence
     * is already expressible as an `InputMapping` with `in = header`.
     *
     * It exists because the long tail is real — a vendor wanting two headers, a
     * date in a particular format, a base64 of a joined pair — and the
     * alternative to an escape hatch is a support ticket per vendor.
     */
    data class Custom(
        val headers: Map<String, String> = emptyMap(),
        val query: Map<String, String> = emptyMap(),
    ) : HttpAuthSpec {
        override val strategy: String get() = "custom"
    }

    companion object {
        /**
         * The bundle field used when a strategy does not name one.
         *
         * A connection secret is either a bare string — which every connection
         * created before this work is — or a JSON bundle. `value` is the name the
         * bare form is presented under, so one code path reads both.
         */
        const val DEFAULT_SECRET_FIELD = "value"

        /** Every strategy discriminator, for validation and for the UI. */
        val STRATEGIES = setOf(
            "inherit", "none", "api_key_header", "api_key_query", "bearer", "basic",
            "oauth2_client_credentials", "oauth2_authorization_code", "hmac", "custom",
        )

        /**
         * The legacy `connections.auth_type` values, mapped onto strategies.
         *
         * `api_key` keeps `x-api-key` on purpose. It is the wrong default for new
         * tools and the right one for existing ones: a tool that has been calling
         * a service successfully with that header must keep sending it. New tools
         * get the header from their OpenAPI document, or from the operator.
         */
        fun fromLegacyAuthType(authType: String?, username: String?): HttpAuthSpec =
            when (authType?.lowercase()?.trim()) {
                null, "", "none" -> None
                "api_key" -> ApiKeyHeader(header = "x-api-key")
                "bearer", "jwt", "token" -> Bearer()
                "basic" -> Basic(username = username ?: "")
                "oauth2", "oauth" -> Bearer()
                else -> Bearer()
            }
    }
}
