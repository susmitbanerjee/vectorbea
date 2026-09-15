package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.net.OutboundHttp
import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Applies an [HttpAuthSpec] to a prepared request.
 *
 * ── EVERY CREDENTIAL THAT PASSES THROUGH HERE IS REGISTERED ─────────────────
 * `protect` is called on the way to the header, never separately, so there is no
 * ordering in which a value is used before it is registered for scrubbing. That
 * is the whole reason [SecretScope.protect] returns its argument: a call site
 * that wanted to skip registration would have to go out of its way.
 *
 * ── THE APPLIER NEVER LOGS A REQUEST ────────────────────────────────────────
 * Not the headers it added, not the names of the fields it read, not a truncated
 * prefix "for debugging". A four-character prefix of an API key is a four
 * character head start, and every log line containing one exists because it was
 * useful once.
 */
internal class AuthApplier(
    private val tokenStore: OAuth2TokenStore,
) {
    private val log = logger()
    private val mapper = ObjectMapper()
    private val random = SecureRandom()

    /** Headers and query parameters the strategy contributes. */
    data class Applied(
        val headers: List<Pair<String, String>> = emptyList(),
        val query: List<Pair<String, String>> = emptyList(),
        /**
         * True when a credential is in the QUERY STRING.
         *
         * The resolver reads it and drops the query from every URL it reports —
         * to events, to spans, to logs, to the error message. A credential in a
         * query string is already an exposure at the provider's access log; it
         * must not also be one in ours.
         */
        val credentialInQuery: Boolean = false,
    )

    /** Auth could not be established, with a sentence an operator can act on. */
    class AuthException(message: String, val reconnectRequired: Boolean = false) : Exception(message)

    /**
     * Everything the applier needs that is not the spec.
     *
     * [secrets] is the connection's secret bundle, already decrypted. It is
     * passed rather than resolved here because a secret should be decrypted once
     * per call, at one place, by the code that owns the [SecretScope].
     */
    data class Context(
        val workspaceId: UUID,
        val connectionId: UUID?,
        val secrets: Map<String, String>,
        val scope: SecretScope,
        val client: HttpClient,
        val timeoutMs: Long,
    )

    fun apply(
        auth: HttpAuthSpec,
        request: RequestAssembler.Prepared,
        ctx: Context,
    ): Applied = when (auth) {
        is HttpAuthSpec.InheritConnection, is HttpAuthSpec.None -> Applied()

        is HttpAuthSpec.ApiKeyHeader -> {
            val key = require(ctx, auth.secretField, "API key")
            val value = if (auth.prefix.isBlank()) key else "${auth.prefix} $key"
            Applied(headers = listOf(auth.header to ctx.scope.protect(value)))
        }

        is HttpAuthSpec.ApiKeyQuery -> {
            val key = require(ctx, auth.secretField, "API key")
            Applied(
                query = listOf(auth.param to ctx.scope.protect(key)),
                credentialInQuery = true,
            )
        }

        is HttpAuthSpec.Bearer -> {
            val token = require(ctx, auth.secretField, "token")
            val value = if (auth.prefix.isBlank()) token else "${auth.prefix} $token"
            Applied(headers = listOf(auth.header to ctx.scope.protect(value)))
        }

        is HttpAuthSpec.Basic -> {
            val username = auth.usernameSecretField
                ?.let { ctx.secrets[it] }
                ?: auth.username
            /*
             * A blank password is legitimate and common: Stripe's basic mode puts
             * the whole key in the username and sends nothing after the colon. So
             * an absent password field is not an error here, unlike everywhere
             * else in this file.
             */
            val password = ctx.secrets[auth.passwordSecretField] ?: ""
            val encoded = ctx.scope.protectBasicPair(username, password)
            Applied(headers = listOf(auth.header to "Basic $encoded"))
        }

        is HttpAuthSpec.OAuth2ClientCredentials -> {
            val token = clientCredentialsToken(auth, ctx)
            val value = if (auth.prefix.isBlank()) token else "${auth.prefix} $token"
            Applied(headers = listOf(auth.header to ctx.scope.protect(value)))
        }

        is HttpAuthSpec.OAuth2AuthorizationCode -> {
            val token = delegatedToken(auth, ctx)
            val value = if (auth.prefix.isBlank()) token else "${auth.prefix} $token"
            Applied(headers = listOf(auth.header to ctx.scope.protect(value)))
        }

        is HttpAuthSpec.Hmac -> hmac(auth, request, ctx)

        is HttpAuthSpec.Custom -> {
            val bindings = mapOf("secret" to ctx.secrets)
            Applied(
                headers = auth.headers.map { (k, v) ->
                    k to ctx.scope.protect(renderAuthTemplate(v, bindings, k))
                },
                query = auth.query.map { (k, v) ->
                    k to ctx.scope.protect(renderAuthTemplate(v, bindings, k))
                },
                credentialInQuery = auth.query.isNotEmpty(),
            )
        }
    }

    private fun renderAuthTemplate(
        template: String,
        bindings: Map<String, Any?>,
        name: String,
    ): String = try {
        SpecTemplate.render(template, bindings)
    } catch (e: SpecTemplate.MissingBinding) {
        throw AuthException(
            "This tool's custom auth needs '${e.name}' for '$name', and the connection's " +
                "credential does not contain it. Re-save the connection with that field.",
            reconnectRequired = true,
        )
    }

    private fun require(ctx: Context, field: String, what: String): String =
        ctx.secrets[field]?.takeIf { it.isNotEmpty() }
            ?: throw AuthException(
                "This tool needs the $what from its connection and the connection has no " +
                    "'$field'. Reconnect it in Connections.",
                reconnectRequired = true,
            )

    // ── OAuth2 ───────────────────────────────────────────────────────────────

    private fun clientCredentialsToken(
        auth: HttpAuthSpec.OAuth2ClientCredentials,
        ctx: Context,
    ): String {
        val key = OAuth2TokenStore.Key(
            workspaceId = ctx.workspaceId,
            connectionId = ctx.connectionId
                ?: throw AuthException("OAuth2 needs a connection, and this tool has none."),
            scopes = auth.scopes.sorted().joinToString(" "),
            audience = auth.audience,
        )
        tokenStore.cached(key, auth.expirySkewSeconds)?.let { return it.accessToken }

        synchronized(tokenStore.lockFor(key)) {
            /* Re-check inside the lock: the thread that held it was very likely
               fetching the token this one is about to fetch. */
            tokenStore.cached(key, auth.expirySkewSeconds)?.let { return it.accessToken }

            val form = LinkedHashMap<String, String>()
            form["grant_type"] = "client_credentials"
            if (auth.scopes.isNotEmpty()) form["scope"] = auth.scopes.joinToString(" ")
            auth.audience?.let { form["audience"] = it }
            auth.extraParams.forEach { (k, v) -> form[k] = v }

            val headers = mutableListOf<Pair<String, String>>()
            val clientSecret = require(ctx, auth.clientSecretField, "client secret")
            when (auth.clientAuth) {
                HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BASIC_HEADER -> {
                    headers += "Authorization" to
                        "Basic ${ctx.scope.protectBasicPair(auth.clientId, clientSecret)}"
                }

                HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BODY -> {
                    form["client_id"] = auth.clientId
                    form["client_secret"] = ctx.scope.protect(clientSecret)
                }
            }

            val entry = fetchToken(auth.tokenUrl, form, headers, ctx, refreshing = false)
            tokenStore.put(key, entry)
            return entry.accessToken
        }
    }

    private fun delegatedToken(
        auth: HttpAuthSpec.OAuth2AuthorizationCode,
        ctx: Context,
    ): String {
        val connectionId = ctx.connectionId
            ?: throw AuthException("OAuth2 needs a connection, and this tool has none.")
        val key = OAuth2TokenStore.Key(ctx.workspaceId, connectionId, "", null)

        tokenStore.cached(key, auth.expirySkewSeconds)?.let { return it.accessToken }

        synchronized(tokenStore.lockFor(key)) {
            tokenStore.cached(key, auth.expirySkewSeconds)?.let { return it.accessToken }

            /*
             * Three places hold a token, in decreasing order of freshness: the
             * durable table (written by whichever process last refreshed), then
             * the connection's own secret (written when the user connected). The
             * table is consulted first precisely because a rotating provider has
             * invalidated whatever the connection's secret still says.
             */
            val persisted = tokenStore.loadPersisted(ctx.workspaceId, connectionId)
            persisted?.takeIf { it.accessToken.isNotBlank() && it.isFresh(auth.expirySkewSeconds) }
                ?.let { tokenStore.put(key, it); return ctx.scope.protect(it.accessToken) }

            val storedAccess = ctx.secrets[auth.accessTokenField]
            val storedExpiry = ctx.secrets[auth.expiresAtField]?.toLongOrNull()?.let { it * 1_000 }
            if (persisted == null && !storedAccess.isNullOrBlank()) {
                val entry = OAuth2TokenStore.Entry(storedAccess, storedExpiry)
                if (entry.isFresh(auth.expirySkewSeconds)) {
                    tokenStore.put(key, entry)
                    return ctx.scope.protect(storedAccess)
                }
            }

            val refreshToken = persisted?.refreshToken
                ?: ctx.secrets[auth.refreshTokenField]?.takeIf { it.isNotBlank() }
                ?: throw AuthException(
                    "This tool's access has expired and there is no refresh token to renew it. " +
                        "Reconnect the integration in Connections.",
                    reconnectRequired = true,
                )

            val form = LinkedHashMap<String, String>()
            form["grant_type"] = "refresh_token"
            form["refresh_token"] = ctx.scope.protect(refreshToken)
            if (auth.scopes.isNotEmpty()) form["scope"] = auth.scopes.joinToString(" ")

            val headers = mutableListOf<Pair<String, String>>()
            val clientSecret = ctx.secrets[auth.clientSecretField]
            when {
                clientSecret == null -> form["client_id"] = auth.clientId
                auth.clientAuth == HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BASIC_HEADER ->
                    headers += "Authorization" to
                        "Basic ${ctx.scope.protectBasicPair(auth.clientId, clientSecret)}"

                else -> {
                    form["client_id"] = auth.clientId
                    form["client_secret"] = ctx.scope.protect(clientSecret)
                }
            }

            val fetched = fetchToken(auth.tokenUrl, form, headers, ctx, refreshing = true)
            /*
             * A provider that rotates returns a NEW refresh token and retires the
             * one just used. One that does not, returns nothing — and carrying the
             * old one forward is what keeps the next refresh working. Guessing
             * wrong in either direction breaks the connection silently.
             */
            val entry = fetched.copy(refreshToken = fetched.refreshToken ?: refreshToken)
            tokenStore.put(key, entry)
            tokenStore.persist(ctx.workspaceId, connectionId, entry)
            return entry.accessToken
        }
    }

    /**
     * One token request.
     *
     * ── THE ERROR HANDLING IS THE INTERESTING PART ──────────────────────────
     * A token endpoint answers `400 invalid_grant` for a revoked or already-used
     * refresh token, and `401 invalid_client` for a wrong client secret. Those
     * are completely different repairs — the first needs a human to reconnect,
     * the second needs an operator to fix a configuration — and both arrive as a
     * short JSON body that no agent will interpret. Splitting them here is what
     * turns "the tool returned 400" into a sentence naming the fix.
     */
    private fun fetchToken(
        tokenUrl: String,
        form: Map<String, String>,
        headers: List<Pair<String, String>>,
        ctx: Context,
        refreshing: Boolean,
    ): OAuth2TokenStore.Entry {
        val body = form.entries.joinToString("&") { (k, v) ->
            "${RequestAssembler.encodeQuery(k)}=${RequestAssembler.encodeQuery(v)}"
        }
        val builder = HttpRequest.newBuilder()
            .uri(URI.create(tokenUrl))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
        headers.forEach { (k, v) -> builder.header(k, v) }
        builder.POST(HttpRequest.BodyPublishers.ofString(body))

        val result = try {
            OutboundHttp.send(
                builder,
                totalCallMs = minOf(ctx.timeoutMs, TOKEN_CALL_CEILING_MS),
                maxResponseBytes = TOKEN_RESPONSE_LIMIT,
                httpClient = ctx.client,
            )
        } catch (e: Exception) {
            throw AuthException(
                "Could not reach the token endpoint at ${hostOf(tokenUrl)}: " +
                    "${e.javaClass.simpleName}. The credential is fine; the network is not."
            )
        }

        if (result.statusCode !in 200..299) {
            val error = runCatching { mapper.readTree(result.body).path("error").asText("") }
                .getOrDefault("")
            val revoked = error == "invalid_grant" || result.statusCode == 400 && refreshing
            log.warn(
                "[oauth] token request refused [host={}, status={}, error={}]",
                hostOf(tokenUrl), result.statusCode, error.ifBlank { "unspecified" },
            )
            throw AuthException(
                when {
                    revoked -> "This integration's access was revoked or has expired beyond " +
                        "renewal. Reconnect it in Connections."

                    error == "invalid_client" -> "The client credentials for this integration " +
                        "were rejected. Check the client id and secret on the connection."

                    error == "invalid_scope" -> "The token endpoint rejected the requested " +
                        "scopes. Narrow the scopes on the tool, or grant them at the provider."

                    else -> "The token endpoint returned HTTP ${result.statusCode}" +
                        (error.takeIf { it.isNotBlank() }?.let { " ($it)" } ?: "") + "."
                },
                reconnectRequired = revoked,
            )
        }

        val node = runCatching { mapper.readTree(result.body) }.getOrNull()
            ?: throw AuthException("The token endpoint returned a response that is not JSON.")
        val access = node.path("access_token").asText("").takeIf { it.isNotBlank() }
            ?: throw AuthException("The token endpoint returned no access_token.")
        val expiresIn = node.get("expires_in")?.takeIf { it.isNumber }?.asLong()

        return OAuth2TokenStore.Entry(
            accessToken = ctx.scope.protect(access),
            expiresAtMs = expiresIn?.let { System.currentTimeMillis() + it * 1_000 },
            refreshToken = node.get("refresh_token")?.asText()?.takeIf { it.isNotBlank() }
                ?.let { ctx.scope.protect(it) },
        )
    }

    // ── HMAC ─────────────────────────────────────────────────────────────────

    /**
     * Sign the request.
     *
     * The canonical string is built from the request that is ABOUT TO BE SENT —
     * its real path, its real query string, the bytes of its real body — and not
     * from the spec. A signature computed over an intended request and sent with
     * a different one is the single most common way an HMAC integration fails,
     * and it fails with a 401 that says nothing.
     */
    private fun hmac(
        auth: HttpAuthSpec.Hmac,
        request: RequestAssembler.Prepared,
        ctx: Context,
    ): Applied {
        val secret = require(ctx, auth.secretField, "signing key")
        val nowMs = System.currentTimeMillis()
        val timestamp = when (auth.timestampUnit) {
            HttpAuthSpec.Hmac.TimestampUnit.SECONDS -> (nowMs / 1_000).toString()
            HttpAuthSpec.Hmac.TimestampUnit.MILLISECONDS -> nowMs.toString()
        }
        val nonce = UUID(random.nextLong(), random.nextLong()).toString()
        val bodyBytes = request.body ?: ByteArray(0)

        val bindings = mapOf(
            "method" to request.method,
            "path" to request.path,
            "query" to request.queryString,
            "host" to hostOf(request.url),
            "timestamp" to timestamp,
            "nonce" to nonce,
            "body" to String(bodyBytes),
            "bodySha256Hex" to hex(request.bodySha256),
            "bodySha256Base64" to Base64.getEncoder().encodeToString(request.bodySha256),
            "keyId" to (auth.keyId ?: ""),
        )
        val canonical = try {
            SpecTemplate.render(auth.canonicalTemplate, bindings)
        } catch (e: SpecTemplate.MissingBinding) {
            throw AuthException(
                "The signing template refers to '${e.name}', which is not one of: " +
                    bindings.keys.joinToString(", ") + "."
            )
        }

        val mac = try {
            Mac.getInstance(auth.algorithm).apply {
                init(SecretKeySpec(secret.toByteArray(), auth.algorithm))
            }
        } catch (e: Exception) {
            throw AuthException("'${auth.algorithm}' is not an HMAC algorithm this runtime provides.")
        }
        val digest = mac.doFinal(canonical.toByteArray())
        val encoded = when (auth.encoding) {
            HttpAuthSpec.Hmac.Encoding.HEX -> hex(digest)
            HttpAuthSpec.Hmac.Encoding.BASE64 -> Base64.getEncoder().encodeToString(digest)
            HttpAuthSpec.Hmac.Encoding.BASE64_URL ->
                Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
        }

        val headers = mutableListOf<Pair<String, String>>()
        headers += auth.signatureHeader to
            (if (auth.signaturePrefix.isBlank()) encoded else "${auth.signaturePrefix} $encoded")
        auth.timestampHeader?.let { headers += it to timestamp }
        auth.nonceHeader?.let { headers += it to nonce }
        auth.keyIdHeader?.let { h -> auth.keyId?.let { headers += h to it } }

        /*
         * The DIGEST is registered, not just the key. It is not itself a secret —
         * it is derived and single-use — but it is computed FROM one, and a log
         * line pairing a canonical string with its digest is a gift to anyone
         * mounting an offline attack on a weak key.
         */
        ctx.scope.protect(secret)
        ctx.scope.protect(encoded)
        return Applied(headers = headers)
    }

    private fun hex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    private fun hostOf(url: String): String =
        runCatching { URI(url).host ?: "the endpoint" }.getOrDefault("the endpoint")

    private companion object {
        /** A token fetch is not the tool's call and must not spend its whole budget. */
        const val TOKEN_CALL_CEILING_MS = 15_000L
        const val TOKEN_RESPONSE_LIMIT = 64L * 1024
    }
}
