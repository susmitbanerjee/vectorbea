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
                HttpTester.test(HttpTester.HttpTestInput(
                    url = serverUrl,
                    authType = if (plaintextSecret.isNullOrBlank()) "none" else "bearer",
                    apiKey = plaintextSecret, username = null, password = null,
                ))
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

    private fun testDatabase(conn: Connection, secret: String?): ConnectionTestResult {
        val config = parseConfig(conn.configJson)
        val dbType = conn.provider

        // Secret may be: full connection string OR just the password
        val (connUrl, password) = when {
            secret != null && (secret.startsWith("postgres") || secret.startsWith("mysql") ||
                secret.startsWith("mongodb") || secret.startsWith("jdbc:")) ->
                secret to null   // full connection string
            else ->
                null to secret   // password only
        }

        return DbTester.test(DbTester.DbTestInput(
            dbType = dbType,
            connectionUrl = connUrl ?: config["connectionUrl"] as? String,
            password = password,
            username = config["username"] as? String ?: config["user"] as? String,
            host = config["host"] as? String,
            port = (config["port"] as? Number)?.toInt(),
            database = config["database"] as? String ?: config["db"] as? String,
            sslRequired = config["sslRequired"] as? Boolean,
        ))
    }

    private fun testDatabaseUnsaved(
        provider: String,
        plaintextSecret: String?,
        config: Map<String, Any?>,
    ): ConnectionTestResult {
        val (connUrl, password) = when {
            plaintextSecret != null && (plaintextSecret.startsWith("postgres") ||
                plaintextSecret.startsWith("mysql") || plaintextSecret.startsWith("mongodb") ||
                plaintextSecret.startsWith("jdbc:")) ->
                plaintextSecret to null
            else ->
                null to plaintextSecret
        }
        return DbTester.test(DbTester.DbTestInput(
            dbType = provider,
            connectionUrl = connUrl ?: config["connectionUrl"] as? String,
            password = password,
            username = config["username"] as? String ?: config["user"] as? String,
            host = config["host"] as? String,
            port = (config["port"] as? Number)?.toInt(),
            database = config["database"] as? String ?: config["db"] as? String,
            sslRequired = config["sslRequired"] as? Boolean,
        ))
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    private fun testHttp(conn: Connection, secret: String?): ConnectionTestResult {
        val config = parseConfig(conn.configJson)
        // Fall back to a known base URL for recognised SaaS providers so that
        // connections saved before baseUrl was included in the config still work.
        val baseUrl = (config["baseUrl"] as? String ?: config["base_url"] as? String
            ?: config["url"] as? String
            ?: knownSaasBaseUrl(conn.provider))
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "HTTP connection requires a baseUrl in config")

        val healthPath = config["healthPath"] as? String ?: knownSaasHealthPath(conn.provider)

        return HttpTester.test(HttpTester.HttpTestInput(
            url = baseUrl,
            authType = conn.authType,
            apiKey = secret,
            username = config["username"] as? String,
            password = null,  // password resolved via secret
            apiKeyHeaderName = config["authHeaderName"] as? String
                ?: config["apiKeyHeaderName"] as? String,
            healthPath = healthPath,
        ))
    }

    /** Canonical API base URLs for known SaaS providers — used as a fallback
     *  when the connection was saved without an explicit baseUrl in config. */
    private fun knownSaasBaseUrl(provider: String): String? = when (provider.lowercase()) {
        "slack"      -> "https://slack.com/api"
        "gmail"      -> "https://gmail.googleapis.com"
        "salesforce" -> "https://login.salesforce.com/services/data/v59.0"
        "hubspot"    -> "https://api.hubapi.com"
        "zendesk"    -> "https://api.zendesk.com/api/v2"
        "jira"       -> "https://api.atlassian.com"
        "github"     -> "https://api.github.com"
        else         -> null
    }

    /** Lightweight health-check paths for known SaaS providers that validate auth. */
    private fun knownSaasHealthPath(provider: String): String? = when (provider.lowercase()) {
        "slack"  -> "/api.test"   // returns {"ok":true} with valid token, {"ok":false} without
        "github" -> "/rate_limit" // always returns 200 + rate-limit headers
        else     -> null
    }

    private fun testHttpUnsaved(
        provider: String,
        authType: String,
        plaintextSecret: String?,
        config: Map<String, Any?>,
    ): ConnectionTestResult {
        val baseUrl = (config["baseUrl"] as? String ?: config["base_url"] as? String
            ?: config["url"] as? String)
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "HTTP connection requires a baseUrl in config")

        return HttpTester.test(HttpTester.HttpTestInput(
            url = baseUrl,
            authType = authType,
            apiKey = plaintextSecret,
            username = config["username"] as? String,
            password = null,
            apiKeyHeaderName = config["authHeaderName"] as? String
                ?: config["apiKeyHeaderName"] as? String,
            healthPath = config["healthPath"] as? String,
        ))
    }

    // ── MCP server (stored as type "tool") ─────────────────────────────────────

    /**
     * MCP servers speak HTTP or SSE. A reachability + auth check against the server
     * URL confirms the endpoint is live and the token (if any) is accepted.
     */
    private fun testMcp(conn: Connection, secret: String?): ConnectionTestResult {
        val config = parseConfig(conn.configJson)
        val serverUrl = firstNonBlank(config, "serverUrl", "server_url", "url", "baseUrl", "base_url")
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR",
                "MCP connection requires a server URL. Add the MCP server URL first.")
        return HttpTester.test(HttpTester.HttpTestInput(
            url = serverUrl,
            authType = if (secret.isNullOrBlank()) "none" else "bearer",
            apiKey = secret,
            username = null,
            password = null,
        ))
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
