package com.vectorbea.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.http.HttpRequest
import java.nio.ByteBuffer
import java.util.concurrent.Flow

/**
 * A scripted HTTP peer for protocol tests, answering by URL and JSON-RPC method.
 *
 * Answering by method rather than by call order is the point: a client that adds
 * a handshake step must not silently shift every scripted reply by one, which is
 * how an order-based fake turns a protocol change into a test that passes for
 * the wrong reason.
 */
class FakeServer {
    private val mapper = ObjectMapper()

    data class Seen(val method: String, val url: String, val headers: Map<String, List<String>>, val body: String) {
        fun header(name: String): String? =
            headers.entries.firstOrNull { it.key.equals(name, true) }?.value?.firstOrNull()
        fun rpcMethod(): String? = runCatching { ObjectMapper().readTree(body)["method"]?.asText() }.getOrNull()
    }

    val seen: MutableList<Seen> = java.util.Collections.synchronizedList(mutableListOf())
    private val handlers = mutableListOf<(Seen) -> McpTransport.Response?>()

    fun on(handler: (Seen) -> McpTransport.Response?) { handlers += handler }

    fun onRpc(method: String, reply: (Seen, JsonNode) -> McpTransport.Response) = on { s ->
        if (s.method != "POST") return@on null
        val node = runCatching { mapper.readTree(s.body) }.getOrNull() ?: return@on null
        if (node["method"]?.asText() != method) null else reply(s, node)
    }

    fun onGet(url: String, status: Int = 200, body: String) = on { s ->
        if (s.method == "GET" && s.url == url) McpTransport.Response(status, body) else null
    }

    fun transport(): McpTransport = McpTransport { request, _, _ ->
        val s = Seen(request.method(), request.uri().toString(), request.headers().map(), bodyOf(request))
        seen += s
        handlers.firstNotNullOfOrNull { it(s) } ?: McpTransport.Response(404, "")
    }

    companion object {
        fun result(id: JsonNode?, result: String) =
            """{"jsonrpc":"2.0","id":${id ?: "null"},"result":$result}"""

        fun json(body: String, vararg headers: Pair<String, String>) =
            McpTransport.Response(200, body, headers.associate { it.first to listOf(it.second) })

        /** Drain a request's body publisher. Synchronous for `ofString`, which is all the client uses. */
        fun bodyOf(request: HttpRequest): String {
            val publisher = request.bodyPublisher().orElse(null) ?: return ""
            val out = StringBuilder()
            publisher.subscribe(object : Flow.Subscriber<ByteBuffer> {
                override fun onSubscribe(s: Flow.Subscription) = s.request(Long.MAX_VALUE)
                override fun onNext(item: ByteBuffer) {
                    val bytes = ByteArray(item.remaining()); item.get(bytes); out.append(String(bytes, Charsets.UTF_8))
                }
                override fun onError(throwable: Throwable) = Unit
                override fun onComplete() = Unit
            })
            return out.toString()
        }
    }
}
