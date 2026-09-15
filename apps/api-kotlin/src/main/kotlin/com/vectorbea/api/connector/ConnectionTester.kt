package com.vectorbea.api.connector

import com.vectorbea.api.repository.Connection
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.secrets.SecretServiceUnavailableException
import com.vectorbea.api.secrets.SecretNotFoundException
import com.vectorbea.api.secrets.SecretDecryptionException
import org.slf4j.LoggerFactory

/**
 * Orchestrates connection testing by dispatching to the appropriate tester
 * based on [Connection.type] and [Connection.provider].
 *
 * SECURITY:
 * - Resolves secrets via [SecretService.resolveSecretForRuntime] — the only
 *   authorised path to plaintext.
 * - Resolved plaintext is held only for the duration of the test call.
 * - Resolved plaintext is NEVER stored, logged, or returned to callers.
 * - [ConnectionTestResult] contains no credentials.
 */
class ConnectionTester(private val secretService: SecretService) {

    private val log = LoggerFactory.getLogger(ConnectionTester::class.java)

    fun test(connection: Connection): ConnectionTestResult {
        log.info("Testing connection [id={}, type={}, provider={}]",
            connection.id, connection.type, connection.provider)

        val type = connection.type.lowercase()

        // Resolve secret — scoped to connection's workspace to prevent cross-tenant leakage
        val resolvedSecret: String? = resolveSecret(connection.secretRef, connection.workspaceId)

        // LLM, database and HTTP connections cannot be meaningfully tested without
        // credentials. The reachability-style types (MCP / vector store / object
        // storage) can still be tested unauthenticated, so they don't require one.
        val secretRequired = type == "llm" || type == "database" ||
            (type == "http" && connection.authType.lowercase() != "none")
        if (secretRequired && resolvedSecret == null) {
            return ConnectionTestResult.failed(
                0, "SECRET_MISSING",
                "No secret configured for this connection. Add credentials first."
            )
        }

        return try {
            when (type) {
                "llm"                          -> testLlm(connection, resolvedSecret)
                "database"                     -> testDatabase(connection, resolvedSecret)
                "http"                         -> testHttp(connection, resolvedSecret)
                "tool", "mcp", "mcp_server"    -> testMcp(connection, resolvedSecret)
                "vector_store", "vector", "vectorstore" -> testVectorStore(connection, resolvedSecret)
                "object_storage", "object-storage", "storage", "blob" -> testObjectStorage(connection, resolvedSecret)
                else -> ConnectionTestResult.failed(0, "UNSUPPORTED_TYPE",
                    "Connection type '${connection.type}' is not yet testable")
            }
        } finally {
            // Explicit no-op — JVM GC handles memory; we just don't hold the ref longer
        }
    }

    /**
     * Test with an unsaved (transient) connection — used for POST /test-unsaved.
     * The plaintext secret is supplied directly (just received from the client over TLS).
     * It MUST NOT be stored or logged.
     */
    fun testUnsaved(
        type: String,
        provider: String,
        authType: String,
        plaintextSecret: String?,
        config: Map<String, Any?>,
    ): ConnectionTestResult {
        log.info("Testing unsaved connection [type={}, provider={}]", type, provider)

        return when (type.lowercase()) {
            "llm"      -> testLlmUnsaved(provider, authType, plaintextSecret, config)
            "database" -> testDatabaseUnsaved(provider, plaintextSecret, config)
            "http"     -> testHttpUnsaved(provider, authType, plaintextSecret, config)
            "tool", "mcp", "mcp_server" -> {
                val serverUrl = firstNonBlank(config, "serverUrl", "server_url", "url", "baseUrl", "base_url")
                    ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR", "MCP connection requires a server URL.")
                /* The same probe the saved path takes. The connect wizard tests
                   here and the connection page tests there, and a credential
                   that passes one and fails the other is the bug SaasEndpoints
                   was written to end. */
                McpTester.test(
                    serverUrl = serverUrl,
                    bearerToken = plaintextSecret,
                    transport = (config["transport"] as? String) ?: "streamable-http",
                )
            }
            "vector_store", "vector", "vectorstore" -> {
                val endpoint = firstNonBlank(config, "endpoint", "url", "host", "baseUrl", "base_url")
                    ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR", "Vector store connection requires an endpoint URL.")
                val url = if (endpoint.startsWith("http")) endpoint else "https://$endpoint"
                val (at, header) = when {
                    provider.lowercase().contains("pinecone") -> "api_key" to "Api-Key"
                    provider.lowercase().contains("qdrant")   -> "api_key" to "api-key"
                    else                                       -> "bearer" to null
                }
                HttpTester.test(HttpTester.HttpTestInput(
                    url = url,
                    authType = if (plaintextSecret.isNullOrBlank()) "none" else at,
                    apiKey = plaintextSecret, username = null, password = null, apiKeyHeaderName = header,
                    healthPath = config["healthPath"] as? String,
                ))
            }
            "object_storage", "object-storage", "storage", "blob" -> {
                val endpoint = firstNonBlank(config, "endpoint", "url", "bucketUrl", "bucket_url", "baseUrl", "base_url")
                    ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR", "Object storage connection requires an endpoint or bucket URL.")
                val url = if (endpoint.startsWith("http")) endpoint else "https://$endpoint"
                HttpTester.testReachability(url)
            }
            else       -> ConnectionTestResult.failed(0, "UNSUPPORTED_TYPE",
                "Connection type '$type' is not yet testable")
        }
    }

    // ── Secret resolution ─────────────────────────────────────────────────────

    private fun resolveSecret(secretRef: String?, workspaceId: java.util.UUID): String? {
        if (secretRef.isNullOrBlank()) return null
        return try {
            // Use workspace-scoped resolution to prevent cross-tenant secret access
            secretService.resolveSecretForRuntime(secretRef, workspaceId)
        } catch (e: SecretServiceUnavailableException) {
            log.warn("Secret service unavailable — cannot resolve secret")
            null
        } catch (e: SecretNotFoundException) {
            log.warn("Secret ref not found [ref={}]", secretRef)
            null
        } catch (e: SecretDecryptionException) {
            log.error("Secret decryption failed [ref={}] cause={}", secretRef, e.javaClass.simpleName)
            null
        }
    }

    // ── LLM ──────────────────────────────────────────────────────────────────

    private fun testLlm(conn: Connection, apiKey: String?): ConnectionTestResult {
        val config = parseConfig(conn.configJson)
        return LlmTester.test(LlmTester.LlmTestInput(
            provider = conn.provider,
            apiKey = apiKey,
            baseUrl = config["baseUrl"] as? String ?: config["base_url"] as? String,
            extraConfig = config,
        ))
    }

    private fun testLlmUnsaved(
        provider: String,
        authType: String,
        plaintextSecret: String?,
        config: Map<String, Any?>,
    ) = LlmTester.test(LlmTester.LlmTestInput(
        provider = provider,
        apiKey = plaintextSecret,
        baseUrl = config["baseUrl"] as? String ?: config["base_url"] as? String,
        extraConfig = config,
    ))

    // ── Database ──────────────────────────────────────────────────────────────

    private fun testDatabase(conn: Connection, secret: String?): ConnectionTestResult =
        DbTester.test(databaseInput(conn.provider, parseConfig(conn.configJson), secret))

    private fun testDatabaseUnsaved(
        provider: String,
        plaintextSecret: String?,
        config: Map<String, Any?>,
    ): ConnectionTestResult = DbTester.test(databaseInput(provider, config, plaintextSecret))

    // ── HTTP ──────────────────────────────────────────────────────────────────

    private fun testHttp(conn: Connection, secret: String?): ConnectionTestResult =
        httpProbe(conn.provider, conn.authType, secret, parseConfig(conn.configJson))

    /** Canonical API base URLs for known SaaS providers — used as a fallback
     *  when the connection was saved without an explicit baseUrl in config. */
    private fun knownSaasBaseUrl(provider: String): String? = SaasEndpoints.of(provider)?.baseUrl

    /** Lightweight health-check paths for known SaaS providers that validate auth. */
    private fun knownSaasHealthPath(provider: String): String? = SaasEndpoints.of(provider)?.healthPath

    private fun testHttpUnsaved(
        provider: String,
        authType: String,
        plaintextSecret: String?,
        config: Map<String, Any?>,
    ): ConnectionTestResult = httpProbe(provider, authType, plaintextSecret, config)

    /* ══════════════════════════════════════════════════════════════════════════
       ONE HTTP PROBE, FOR SAVED AND UNSAVED ALIKE.

       THE BUG THIS CLOSES. There were two of these and they behaved differently.
       The saved path fell back to `knownSaasBaseUrl` / `knownSaasHealthPath` when
       config carried none; the unsaved path did not, and failed with "HTTP
       connection requires a baseUrl in config". Worse, the two health paths in
       play for GitHub disagreed — the connect dialog sent `/user`, the saved
       path used `/rate_limit`. A GitHub App installation token is REFUSED by
       `/user` and accepted by `/rate_limit`, so the same credential could fail
       in the wizard and then pass on the connection page, or the reverse. The
       one screen whose entire promise is "nothing is saved until it has been
       proven to work" was proving something slightly different each time.

       The server now owns the endpoint table outright. The client may still send
       a baseUrl — it needs one to display — but it cannot get the probe wrong,
       because it no longer decides it.
    ══════════════════════════════════════════════════════════════════════════ */
    private fun httpProbe(
        provider: String,
        authType: String,
        secret: String?,
        config: Map<String, Any?>,
    ): ConnectionTestResult {
        /* A channel webhook has no base URL and no health path: the URL is the
           credential, and testing it must not post to the channel. */
        if (authType.equals("webhook_url", ignoreCase = true)) return WebhookUrlTester.test(provider, secret)

        val known = SaasEndpoints.of(provider)
        val configuredBase = firstNonBlank(config, "baseUrl", "base_url", "url")
        val baseUrl = (
            // A user-supplied base wins only for providers that are genuinely
            // per-tenant (a Jira site, a Zendesk subdomain). Everywhere else the
            // canonical base is the one the health path is written against, and
            // pairing a stale saved base with a fresh path yields a 404 that
            // reads like the vendor moved their API.
            if (known != null && !known.perTenantBase) known.baseUrl else configuredBase ?: known?.baseUrl
            ) ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "This connection has no base URL to call. Add one, or pick a provider Vectorbea knows.")

        val perTenant = known != null && known.perTenantBase && configuredBase != null
        val healthPath = when {
            perTenant -> known.tenantHealthPath ?: known.healthPath
            known != null -> known.healthPath
            else -> config["healthPath"] as? String
        }
        val effectiveAuth = known?.authTypeFor(authType) ?: authType

        return HttpTester.test(HttpTester.HttpTestInput(
            url = baseUrl,
            // The vendor's own scheme wins over the connection's declared one.
            // Atlassian API tokens are Basic email:token and Bearer is refused,
            // so a connection saved as `api_key` would otherwise always 401.
            authType = effectiveAuth,
            apiKey = secret,
            username = config["username"] as? String ?: config["email"] as? String,
            password = if (effectiveAuth == "basic") secret else null,
            apiKeyHeaderName = known?.apiKeyHeaderName
                ?: config["authHeaderName"] as? String
                ?: config["apiKeyHeaderName"] as? String,
            healthPath = healthPath,
            extraHeaders = known?.extraHeaders ?: emptyMap(),
            credentialSupplied = !secret.isNullOrBlank(),
        ))
    }

    /* ══════════════════════════════════════════════════════════════════════════
       WHAT "TESTED" MEANS FOR EACH SaaS PROVIDER.

       A health path here is not decoration. Without one the probe HEADs the base
       URL, and a base URL that answers proves only that the vendor is up — the
       credential is never presented, so an expired token tests GREEN and fails
       on the first run. Every entry below names an endpoint that REJECTS a bad
       credential.

       Two entries exist in this shape because their vendor breaks the obvious
       choice:

        · NOTION refuses any request without a `Notion-Version` header — with
          400, not 401. `GET /v1/users/me` on a perfectly good integration token
          returned "HTTP GET returned 400", so Notion could not be connected at
          all.

        · GOOGLE SHEETS has no unauthenticated-safe collection endpoint. HEADing
          `sheets.googleapis.com/v4` gives 404, which `HttpTester` reported as
          "Endpoint reachable (404)" — a GREEN result for a credential that was
          never sent. It is probed through the OpenID userinfo endpoint instead,
          which every Google consent flow grants and which 401s on a dead token.
    ══════════════════════════════════════════════════════════════════════════ */
    internal data class SaasEndpoint(
        val baseUrl: String,
        /** Must reject an invalid credential. */
        val healthPath: String?,
        /** Auth scheme the vendor mandates, overriding the connection's own. */
        val forcedAuthType: String? = null,
        val apiKeyHeaderName: String? = null,
        val extraHeaders: Map<String, String> = emptyMap(),
        /** True when the base URL is the customer's own site rather than a shared API host. */
        val perTenantBase: Boolean = false,
        /** Health path to use against a customer-supplied base. */
        val tenantHealthPath: String? = null,
    ) {
        fun authTypeFor(declared: String): String = forcedAuthType ?: declared
    }

    internal object SaasEndpoints {
        private val TABLE: Map<String, SaasEndpoint> = mapOf(
            // `HttpTester` special-cases Slack to POST auth.test and read `ok`.
            "slack" to SaasEndpoint("https://slack.com/api", "/auth.test"),

            // Returns the mailbox address, so it proves WHICH account is connected.
            "gmail" to SaasEndpoint("https://gmail.googleapis.com", "/gmail/v1/users/me/profile"),

            // See the note above: Sheets has no safe collection endpoint of its own.
            "google-sheets" to SaasEndpoint("https://openidconnect.googleapis.com", "/v1/userinfo"),

            // /rate_limit rather than /user: a GitHub App installation token is
            // refused by /user with 403 and accepted here, and both are equally
            // good at rejecting a revoked token.
            "github" to SaasEndpoint("https://api.github.com", "/rate_limit"),

            "notion" to SaasEndpoint(
                "https://api.notion.com", "/v1/users/me",
                extraHeaders = mapOf("Notion-Version" to "2022-06-28"),
            ),

            "airtable" to SaasEndpoint("https://api.airtable.com", "/v0/meta/bases"),

            "hubspot" to SaasEndpoint("https://api.hubapi.com", "/account-info/v3/details"),

            // OAuth tokens list the sites they can reach. An API token instead
            // needs the customer's own site, and Atlassian requires Basic
            // email:token there — Bearer is refused outright.
            "jira" to SaasEndpoint(
                "https://api.atlassian.com", "/oauth/token/accessible-resources",
                perTenantBase = true, tenantHealthPath = "/rest/api/3/myself",
            ),

            "zendesk" to SaasEndpoint(
                "https://api.zendesk.com", "/api/v2/users/me.json",
                perTenantBase = true, tenantHealthPath = "/api/v2/users/me.json",
            ),
            "salesforce" to SaasEndpoint(
                "https://login.salesforce.com", "/services/oauth2/userinfo",
                perTenantBase = true, tenantHealthPath = "/services/oauth2/userinfo",
            ),
        )

        /** Tolerant lookup — the provider column carries both `_` and `-` spellings. */
        fun of(provider: String): SaasEndpoint? {
            val key = provider.trim().lowercase()
            return TABLE[key] ?: TABLE[key.replace('_', '-')]
        }

        /** Every provider with a first-class probe. */
        val providers: Set<String> get() = TABLE.keys
    }

    // ── MCP server (stored as type "tool") ─────────────────────────────────────

    /**
     * Ask the server what it offers.
     *
     * A real `tools/list`, not a reachability probe — see [McpTester] for why a
     * HEAD/GET probe failed against every correctly-implemented MCP server,
     * including Vectorbea's own.
     */
    private fun testMcp(conn: Connection, secret: String?): ConnectionTestResult {
        val config = parseConfig(conn.configJson)
        val serverUrl = firstNonBlank(config, "serverUrl", "server_url", "url", "baseUrl", "base_url")
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "MCP connection requires a server URL. Add the MCP server URL first.")
        return McpTester.test(
            serverUrl = serverUrl,
            bearerToken = secret,
            transport = (config["transport"] as? String) ?: "streamable-http",
            connectionId = conn.id,
        )
    }

    // ── Vector store ────────────────────────────────────────────────────────────

    /**
     * Vector stores are reached over HTTP with a provider-specific API-key header
     * (pgvector is just Postgres, so it routes to the database tester).
     */
    private fun testVectorStore(conn: Connection, secret: String?): ConnectionTestResult {
        val provider = conn.provider.lowercase()
        if (provider.contains("pgvector") || provider.contains("postgres")) {
            return testDatabase(conn, secret)
        }
        val config = parseConfig(conn.configJson)
        val endpoint = firstNonBlank(config, "endpoint", "url", "host", "baseUrl", "base_url")
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "Vector store connection requires an endpoint URL. Add it first.")
        val url = if (endpoint.startsWith("http")) endpoint else "https://$endpoint"
        // Provider-specific API-key header; default to Bearer (Weaviate, others).
        val (authType, headerName) = when {
            provider.contains("pinecone") -> "api_key" to "Api-Key"
            provider.contains("qdrant")   -> "api_key" to "api-key"
            else                          -> "bearer" to null
        }
        return HttpTester.test(HttpTester.HttpTestInput(
            url = url,
            authType = if (secret.isNullOrBlank()) "none" else authType,
            apiKey = secret,
            username = null,
            password = null,
            apiKeyHeaderName = headerName,
            healthPath = config["healthPath"] as? String,
        ))
    }

    // ── Object storage ──────────────────────────────────────────────────────────

    /**
     * Object stores (S3 / GCS / Azure Blob / R2 / MinIO) require request signing
     * (SigV4) for authenticated calls, which we don't perform here. A reachability
     * check against the endpoint/bucket URL confirms the host is live — a 401/403
     * still proves the endpoint exists and is serving.
     */
    private fun testObjectStorage(conn: Connection, @Suppress("UNUSED_PARAMETER") secret: String?): ConnectionTestResult {
        val config = parseConfig(conn.configJson)
        val endpoint = firstNonBlank(config, "endpoint", "url", "bucketUrl", "bucket_url", "baseUrl", "base_url")
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "Object storage connection requires an endpoint or bucket URL. Add it first.")
        val url = if (endpoint.startsWith("http")) endpoint else "https://$endpoint"
        return HttpTester.testReachability(url)
    }

    companion object {
        /* ══════════════════════════════════════════════════════════════════════
           WHAT A SAVED DATABASE CONNECTION MEANS — resolved in exactly one place.

           THE BUG THIS CLOSES. `SchemaPreviewRoutes` hand-rolled this same
           mapping, and the two drifted. Testing a connection read
           `config.connectionUrl` when the secret was a bare password; schema
           preview did not, so it fell through to the host/port/database fields —
           which a connection-string connection does not have — and
           `resolvePostgresTarget` defaulted to `localhost:5432/postgres`. The
           API then dialled ITS OWN loopback, was refused, and reported "Could
           not connect to database — verify credentials and network access" about
           a connection the user had just watched go green. Preview also dropped
           `config.db` and `sslRequired` for the same reason: nobody updated the
           copy.

           `DbSchemaFetcher` already carries a comment about the previous round
           of this — "Schema preview and test connection must agree about what a
           connection string means. When they parsed it separately they
           disagreed". They agreed about the URL and still disagreed about where
           to find it. One function, both callers, no third copy.
        ══════════════════════════════════════════════════════════════════════ */
        fun databaseInput(
            provider: String,
            config: Map<String, Any?>,
            secret: String?,
        ): DbTester.DbTestInput {
            /* The secret is either the whole connection string or just the
               password, and which one is decided by how it starts. Anything that
               is not a recognisable URL is treated as a password — including a
               password that happens to begin with "postgres", which the URL
               forms below cannot be confused with because they all carry "://". */
            val looksLikeUrl = secret != null && (
                secret.startsWith("postgres://") || secret.startsWith("postgresql://") ||
                    secret.startsWith("mysql://") || secret.startsWith("mongodb://") ||
                    secret.startsWith("mongodb+srv://") || secret.startsWith("jdbc:")
                )

            return DbTester.DbTestInput(
                dbType = provider,
                connectionUrl = (if (looksLikeUrl) secret else null)
                    ?: config["connectionUrl"] as? String
                    ?: config["connection_string"] as? String
                    ?: config["url"] as? String,
                password = if (looksLikeUrl) null else secret,
                username = config["username"] as? String ?: config["user"] as? String,
                host = config["host"] as? String,
                port = (config["port"] as? Number)?.toInt()
                    ?: (config["port"] as? String)?.toIntOrNull(),
                database = config["database"] as? String ?: config["db"] as? String,
                sslRequired = config["sslRequired"] as? Boolean,
                /* `connectionMode` carries two unrelated vocabularies. It was
                   first written by the connect dialog to record HOW the
                   credential was entered ("connection_string" / "host_port");
                   it now also records HOW THE DATABASE IS REACHED ("direct",
                   "session_pooler", "transaction_pooler"). `poolingMode` is the
                   new, unambiguous key; the old one is still read so a
                   connection saved with a mode in it is honoured, and
                   `ConnectionMode.parse` returns null for the two legacy values
                   rather than mistaking them for a pooling choice. */
                connectionMode = config["poolingMode"] as? String
                    ?: config["connectionMode"] as? String,
                dbHosting = config["dbHosting"] as? String,
            )
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** First non-blank string value among [keys] in [config]. */
    private fun firstNonBlank(config: Map<String, Any?>, vararg keys: String): String? {
        for (k in keys) {
            (config[k] as? String)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        }
        return null
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseConfig(json: String): Map<String, Any?> = try {
        com.fasterxml.jackson.databind.ObjectMapper()
            .readValue(json, Map::class.java) as Map<String, Any?>
    } catch (_: Exception) {
        emptyMap()
    }
}
