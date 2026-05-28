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

        // Resolve secret — plaintext held only in this scope
        val resolvedSecret: String? = resolveSecret(connection.secretRef)
            ?: return ConnectionTestResult.failed(
                0, "SECRET_MISSING",
                "No secret configured for this connection. Add credentials first."
            )

        return try {
            when (connection.type.lowercase()) {
                "llm"      -> testLlm(connection, resolvedSecret)
                "database" -> testDatabase(connection, resolvedSecret)
                "http"     -> testHttp(connection, resolvedSecret)
                else       -> ConnectionTestResult.failed(0, "UNSUPPORTED_TYPE",
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
            else       -> ConnectionTestResult.failed(0, "UNSUPPORTED_TYPE",
                "Connection type '$type' is not yet testable")
        }
    }

    // ── Secret resolution ─────────────────────────────────────────────────────

    private fun resolveSecret(secretRef: String?): String? {
        if (secretRef.isNullOrBlank()) return null
        return try {
            secretService.resolveSecretForRuntime(secretRef)
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
            apiKeyHeaderName = config["apiKeyHeaderName"] as? String,
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
            apiKeyHeaderName = config["apiKeyHeaderName"] as? String,
            healthPath = config["healthPath"] as? String,
        ))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun parseConfig(json: String): Map<String, Any?> = try {
        com.fasterxml.jackson.databind.ObjectMapper()
            .readValue(json, Map::class.java) as Map<String, Any?>
    } catch (_: Exception) {
        emptyMap()
    }
}
