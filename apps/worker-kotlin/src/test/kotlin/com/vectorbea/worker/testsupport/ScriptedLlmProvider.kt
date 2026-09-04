package com.vectorbea.worker.testsupport

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicInteger

/**
 * A provider that answers from a script instead of the network.
 *
 * WHY IT IS AN HttpClient AND NOT AN INTERFACE
 * ────────────────────────────────────────────
 * There is no provider interface to implement. [com.vectorbea.worker.runtime.executor.LlmNodeExecutor]
 * builds a request and hands it to `OutboundHttp.send(..., httpClient = httpClient)`,
 * and that `httpClient` is already a constructor parameter documented as
 * "Injectable for tests". So the seam exists, at the lowest possible level, and
 * substituting here means everything above it runs for real: the provider dialect,
 * the `/v1/chat/completions` path convention, response parsing, token and cost
 * accounting, and the LLM_CALL_* events. A stub one layer higher would test the
 * test.
 *
 * The one thing that did NOT have the seam was the agent brain, which built its own
 * `LlmNodeExecutor` with no way to pass a client through. That is the single
 * production change this needed: an optional `llmHttpClient` on `AgentBrainRunner`,
 * null in production.
 *
 * USAGE
 * ─────
 *   val llm = ScriptedLlmProvider()
 *       .thenAction("""{"type":"THINK","reasoningSummary":"looking"}""")
 *       .thenAction("""{"type":"FINAL","finalOutput":{"answer":"42"}}""")
 *
 * Responses are consumed in order. Running off the end is a hard failure rather
 * than a repeat of the last one: a loop that iterated more times than the test
 * scripted is the bug most of these tests exist to catch, and silently replaying
 * would hide it.
 *
 * Thread-safe because `OutboundHttp` drives `sendAsync`, and a loop under test may
 * be running on a coroutine dispatcher.
 */
class ScriptedLlmProvider(
    /** Tokens reported for each scripted response, so budget assertions are stable. */
    private val tokensPerCall: Int = 10,
) : HttpClient() {

    private val mapper = jacksonObjectMapper()

    /** One scripted reply: an HTTP status and a raw provider body. */
    data class Scripted(val status: Int, val body: String)

    /** What the executor actually sent, decoded far enough to assert on. */
    data class RecordedRequest(
        val uri: String,
        val model: String?,
        val temperature: Double?,
        val maxTokens: Int?,
        val messages: List<Message>,
        val rawBody: String,
    ) {
        data class Message(val role: String, val content: String)

        val systemPrompt: String? get() = messages.firstOrNull { it.role == "system" }?.content
        val userPrompt: String?   get() = messages.firstOrNull { it.role == "user" }?.content
    }

    private val script = java.util.Collections.synchronizedList(mutableListOf<Scripted>())
    private val recorded = java.util.Collections.synchronizedList(mutableListOf<RecordedRequest>())
    private val calls = AtomicInteger(0)

    // ── Scripting ─────────────────────────────────────────────────────────────

    /** Queue a raw provider response body. */
    fun thenRaw(body: String, status: Int = 200): ScriptedLlmProvider =
        apply { script.add(Scripted(status, body)) }

    /**
     * Queue an OpenAI-shaped success whose message content is [content].
     *
     * [content] is what the brain will try to parse as an `AgentAction`, so pass
     * malformed text here to exercise the parse-repair path.
     */
    fun thenContent(content: String): ScriptedLlmProvider = thenRaw(
        """{"choices":[{"message":{"role":"assistant","content":${mapper.writeValueAsString(content)}},
           "finish_reason":"stop"}],"usage":{"prompt_tokens":$tokensPerCall,"completion_tokens":0,
           "total_tokens":$tokensPerCall}}""".trimIndent().replace("\n", ""))

    /** Queue a well-formed `AgentAction` JSON document as the model's reply. */
    fun thenAction(actionJson: String): ScriptedLlmProvider = thenContent(actionJson)

    /** Queue the same action [times] times — for loops that never converge. */
    fun thenActionRepeated(actionJson: String, times: Int): ScriptedLlmProvider =
        apply { repeat(times) { thenAction(actionJson) } }

    /** Queue an HTTP-level failure. */
    fun thenHttpError(status: Int, body: String = """{"error":{"message":"scripted"}}"""):
        ScriptedLlmProvider = thenRaw(body, status)

    /**
     * Answer as a function of the PROMPT rather than of the call index.
     *
     * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
     * A fixed script measures nothing about observation quality: it produces the
     * same number of iterations whether the observation contained the answer or a
     * broken JSON fragment, because the script decided in advance.
     *
     * The question "did the model get what it needed" is precisely a question
     * about the model REACTING to what it was given, so `iterations-to-completion`
     * can only be measured with a responder that reads the prompt.
     *
     * This is a simulation of a model, not a model, and the difference matters:
     * it answers when the observation demonstrably contains the value it was
     * looking for, and asks again when it does not. That is a lower bound on real
     * behaviour — a real model may also be confused by noise it CAN parse — so a
     * measured improvement here is conservative rather than flattering.
     */
    fun respondWith(responder: (RecordedRequest) -> String): ScriptedLlmProvider =
        apply { dynamic = responder }

    @Volatile private var dynamic: ((RecordedRequest) -> String)? = null

    // ── Observation ───────────────────────────────────────────────────────────

    /** How many times a provider call was actually made. */
    fun callCount(): Int = calls.get()

    /** Every request received, in order. */
    fun requests(): List<RecordedRequest> = recorded.toList()

    fun lastRequest(): RecordedRequest? = recorded.lastOrNull()

    /** Responses queued but never consumed — a loop that stopped earlier than scripted. */
    fun remaining(): Int = script.size - calls.get()

    fun reset() {
        script.clear(); recorded.clear(); calls.set(0); dynamic = null
    }

    // ── HttpClient ────────────────────────────────────────────────────────────

    private fun answer(request: HttpRequest): StubHttpResponse<String> {
        val index = calls.getAndIncrement()
        record(request)
        /* A dynamic responder takes precedence and never runs out — it is
           answering the prompt rather than replaying a list. */
        dynamic?.let { fn ->
            val content = mapper.writeValueAsString(fn(recorded.last()))
            return StubHttpResponse(200,
                """{"choices":[{"message":{"role":"assistant","content":$content},""" +
                """"finish_reason":"stop"}],"usage":{"prompt_tokens":$tokensPerCall,""" +
                """"completion_tokens":0,"total_tokens":$tokensPerCall}}""")
        }
        val scripted = synchronized(script) { script.getOrNull(index) }
            ?: throw AssertionError(
                "ScriptedLlmProvider ran out of responses: the code under test made " +
                "${index + 1} provider call(s) but only ${script.size} were scripted. " +
                "Either the loop iterated more than expected, or the script is short.")
        return StubHttpResponse(scripted.status, scripted.body)
    }

    private fun record(request: HttpRequest) {
        val body = bodyOf(request)
        val parsed = runCatching {
            @Suppress("UNCHECKED_CAST")
            val m = mapper.readValue(body, Map::class.java) as Map<String, Any?>
            RecordedRequest(
                uri         = request.uri().toString(),
                model       = m["model"] as? String,
                temperature = (m["temperature"] as? Number)?.toDouble(),
                maxTokens   = (m["max_tokens"] as? Number)?.toInt()
                                  ?: (m["max_completion_tokens"] as? Number)?.toInt(),
                messages    = ((m["messages"] as? List<*>) ?: emptyList<Any>()).mapNotNull { raw ->
                    (raw as? Map<*, *>)?.let {
                        RecordedRequest.Message(
                            role    = it["role"]?.toString() ?: "",
                            content = it["content"]?.toString() ?: "")
                    }
                },
                rawBody     = body,
            )
        }.getOrElse {
            // A body this stub cannot parse is still worth recording — an assertion
            // about what was sent is more useful than a swallowed exception.
            RecordedRequest(request.uri().toString(), null, null, null, emptyList(), body)
        }
        recorded.add(parsed)
    }

    /** Re-reads the request body the executor published, without sending it. */
    private fun bodyOf(request: HttpRequest): String {
        val publisher = request.bodyPublisher().orElse(null) ?: return ""
        val out = StringBuilder()
        val done = CompletableFuture<Void>()
        publisher.subscribe(object : java.util.concurrent.Flow.Subscriber<java.nio.ByteBuffer> {
            override fun onSubscribe(s: java.util.concurrent.Flow.Subscription) = s.request(Long.MAX_VALUE)
            override fun onNext(item: java.nio.ByteBuffer) {
                out.append(Charsets.UTF_8.decode(item))
            }
            override fun onError(t: Throwable) { done.completeExceptionally(t) }
            override fun onComplete() { done.complete(null) }
        })
        runCatching { done.get(1, java.util.concurrent.TimeUnit.SECONDS) }
        return out.toString()
    }

    @Suppress("UNCHECKED_CAST")
    override fun <T : Any?> send(
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler<T>,
    ): HttpResponse<T> = answer(request) as HttpResponse<T>

    @Suppress("UNCHECKED_CAST")
    override fun <T : Any?> sendAsync(
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler<T>,
    ): CompletableFuture<HttpResponse<T>> =
        CompletableFuture.completedFuture(answer(request) as HttpResponse<T>)

    override fun <T : Any?> sendAsync(
        request: HttpRequest,
        responseBodyHandler: HttpResponse.BodyHandler<T>,
        pushPromiseHandler: HttpResponse.PushPromiseHandler<T>?,
    ): CompletableFuture<HttpResponse<T>> = sendAsync(request, responseBodyHandler)

    override fun version(): Version = Version.HTTP_1_1
    override fun connectTimeout(): java.util.Optional<java.time.Duration> = java.util.Optional.empty()
    override fun followRedirects(): Redirect = Redirect.NORMAL
    override fun proxy(): java.util.Optional<java.net.ProxySelector> = java.util.Optional.empty()
    override fun sslContext(): javax.net.ssl.SSLContext = javax.net.ssl.SSLContext.getDefault()
    override fun sslParameters(): javax.net.ssl.SSLParameters = javax.net.ssl.SSLParameters()
    override fun authenticator(): java.util.Optional<java.net.Authenticator> = java.util.Optional.empty()
    override fun executor(): java.util.Optional<java.util.concurrent.Executor> = java.util.Optional.empty()
    override fun cookieHandler(): java.util.Optional<java.net.CookieHandler> = java.util.Optional.empty()
    override fun newWebSocketBuilder(): java.net.http.WebSocket.Builder = throw UnsupportedOperationException()
}
