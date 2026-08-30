package com.vectorbea.worker.testsupport

import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.events.RunEventStore
import java.util.UUID

/**
 * The collaborators every worker test has to supply and none of them care about.
 *
 * These were private helpers duplicated inside individual test files. They are here
 * so a new test can assemble a runnable object without a database, a Redis, a
 * network or a copy-paste — which is the difference between the agent loop being
 * testable and being tested by compiling.
 *
 * Nothing here talks to anything: a [noOpDataSource] throws if a connection is
 * actually requested, which is deliberate. A test that quietly starts needing a
 * database should fail loudly rather than pass against a stub that pretends.
 */

/** A DataSource that exists to be non-null. Asking it for a connection is a bug. */
fun noOpDataSource(): javax.sql.DataSource = object : javax.sql.DataSource {
    override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException(
        "noOpDataSource: this test should not be reaching a database")
    override fun getConnection(u: String?, p: String?): java.sql.Connection = connection
    override fun getLogWriter(): java.io.PrintWriter? = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout(): Int = 0
    override fun getParentLogger(): java.util.logging.Logger = java.util.logging.Logger.getLogger("noop")
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?): Boolean = false
}

fun noOpSecretService() = com.vectorbea.worker.connector.SecretService(null, noOpDataSource())

@Suppress("UNCHECKED_CAST")
fun noOpPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    java.lang.reflect.Proxy.newProxyInstance(
        Thread.currentThread().contextClassLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>

/**
 * A [RunEventStore] that keeps what it was given instead of writing it.
 *
 * The event stream is half the observable behaviour of the agent loop — several
 * decisions are visible ONLY as an event — so a test that cannot read the events
 * can only assert the return value.
 */
class RecordingEventStore : RunEventStore(noOpDataSource(), noOpPubSub()) {
    val events = java.util.Collections.synchronizedList(mutableListOf<RunEvent>())

    override fun appendEvent(event: RunEvent): Int {
        events.add(event)
        return events.size
    }

    override fun forgetRun(runId: UUID) {}

    fun typesEmitted(): List<String> = events.map { it.type.value }
    fun countOf(type: EventType): Int = events.count { it.type == type }
    fun firstOf(type: EventType): RunEvent? = events.firstOrNull { it.type == type }
    fun hasType(type: EventType): Boolean = events.any { it.type == type }
    fun none(pred: (RunEvent) -> Boolean): Boolean = events.none(pred)
}

/** A resolver that hands back one fixed LLM connection without touching a database. */
fun stubLlmResolver(
    workspaceId: UUID,
    environmentId: UUID,
    provider: String = "openai",
    apiKey: String = "test-key",
    baseUrl: String = "https://provider.invalid",
): ConnectionResolver {
    val record = ConnectionRecord(
        id             = UUID.randomUUID(),
        workspaceId    = workspaceId,
        environmentId  = environmentId,
        name           = "test-llm",
        type           = "llm",
        provider       = provider,
        status         = "active",
        authType       = "api_key",
        secretRef      = null,
        // Stored WITHOUT /v1 — every caller appends /v1/chat/completions itself.
        configJson     = mapOf("baseUrl" to baseUrl),
        allowedHosts   = emptyList(),
        allowedPaths   = emptyList(),
        allowedSchemas = emptyList(),
        allowedTables  = emptyList(),
    )
    return object : ConnectionResolver(noOpDataSource(), noOpSecretService()) {
        override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
            /*
             * A FRESH SecretValue per resolve, exactly as the real resolver produces
             * (it decrypts on every call). Sharing one instance across calls fails on
             * the second with "SecretValue has already been cleared", because
             * `useOnce` zeroes the backing array — correct hygiene in production, and
             * the reason a multi-iteration agent loop cannot reuse a stub secret.
             */
            ResolvedConnection(record = record, secret = SecretValue(apiKey.toCharArray()))
    }
}

/** Minimal [java.net.http.HttpResponse] carrying an already-decoded body. */
class StubHttpResponse<T>(
    private val code: Int,
    private val body: T,
) : java.net.http.HttpResponse<T> {
    override fun statusCode(): Int = code
    override fun body(): T = body
    override fun headers(): java.net.http.HttpHeaders =
        java.net.http.HttpHeaders.of(emptyMap()) { _, _ -> true }
    override fun request(): java.net.http.HttpRequest = throw UnsupportedOperationException()
    override fun previousResponse(): java.util.Optional<java.net.http.HttpResponse<T>> =
        java.util.Optional.empty()
    override fun sslSession(): java.util.Optional<javax.net.ssl.SSLSession> = java.util.Optional.empty()
    override fun uri(): java.net.URI = java.net.URI.create("https://provider.invalid")
    override fun version(): java.net.http.HttpClient.Version = java.net.http.HttpClient.Version.HTTP_1_1
}
