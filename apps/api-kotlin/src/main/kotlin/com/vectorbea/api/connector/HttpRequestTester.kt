package com.vectorbea.api.connector

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.mapper
import com.vectorbea.api.security.SsrfGuard
import okhttp3.Dns
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.Proxy
import java.util.Base64
import java.util.concurrent.TimeUnit
import java.util.concurrent.Semaphore

data class HttpTestField(val name: String = "", val value: String = "", val secret: Boolean = false,
                         val fileName: String? = null, val fileBase64: String? = null, val contentType: String? = null)
data class HttpTestRequest(val method: String = "GET", val url: String = "", val headers: List<HttpTestField> = emptyList(),
                           val bodyType: String = "none", val body: String = "", val fields: List<HttpTestField> = emptyList(),
                           val timeoutMs: Long = 30_000, val sensitiveValues: List<String> = emptyList())
data class HttpTestResponse(val status: Int?, val latencyMs: Long, val headers: Map<String, List<String>> = emptyMap(),
                            val body: String = "", val sizeBytes: Int = 0, val truncated: Boolean = false,
                            val errorCode: String? = null, val message: String? = null)

/** Ephemeral API client. No credentials, requests or responses are persisted or logged. */
class HttpRequestTester(private val client: OkHttpClient = publicClient()) {
    companion object {
        const val MAX_BYTES = 1024 * 1024
        const val MAX_RESPONSE = 256 * 1024
        private val slots = Semaphore(8)
        private val forbidden = setOf("host", "content-length", "transfer-encoding", "connection", "upgrade", "proxy-authorization", "proxy-connection", "trailer", "te")
        private val sensitiveName = Regex("(?i)(token|secret|password|authorization|cookie|api[-_]?key)")
        fun publicClient(): OkHttpClient = OkHttpClient.Builder()
            .dns(object : Dns { override fun lookup(hostname: String) = SsrfGuard.resolvePublic(hostname) }).proxy(Proxy.NO_PROXY)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(8, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    }

    internal fun assemble(input: HttpTestRequest): Request {
        require(input.method in setOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")) { "Unsupported HTTP method" }
        require(input.url.length <= 16384) { "URL is too long" }
        val uri = java.net.URI(input.url)
        require(uri.scheme in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null) { "Use an HTTP(S) URL without embedded credentials or a fragment" }
        require(input.headers.size <= 100 && input.fields.size <= 100) { "Maximum 100 headers or form fields" }
        require(input.timeoutMs in 1000..30000) { "Timeout must be between 1000 and 30000 ms" }
        require(input.bodyType in setOf("none", "json", "raw", "form", "multipart")) { "Unsupported body format" }
        require(input.method !in setOf("GET", "HEAD") || input.bodyType == "none") { "GET and HEAD cannot carry a body" }
        require(input.body.toByteArray().size <= MAX_BYTES) { "Request body exceeds 1 MiB" }
        val builder = Request.Builder().url(input.url)
        for (header in input.headers) {
            require(header.name.lowercase() !in forbidden) { "A transport-managed header cannot be set" }
            require(header.name.matches(Regex("[!#$%&'*+.^_`|~0-9a-zA-Z-]+")) && header.value.none { it == '\r' || it == '\n' || it == '\u0000' }) { "Invalid header name or value" }
            require(header.value.length <= 16384) { "Header value too long" }
            // Multipart must carry the boundary generated with the body.
            if (!(input.bodyType == "multipart" && header.name.equals("content-type", true))) builder.addHeader(header.name, header.value)
        }
        val contentType = input.headers.lastOrNull { it.name.equals("content-type", true) }?.value
        val body = when (input.bodyType) {
            "json" -> {
                require(runCatching { mapper.readTree(input.body) }.getOrNull() != null) { "Body must be valid JSON" }
                input.body.toRequestBody((contentType ?: "application/json; charset=utf-8").toMediaTypeOrNull())
            }
            "raw" -> input.body.toRequestBody((contentType ?: "text/plain; charset=utf-8").toMediaTypeOrNull())
            "form" -> FormBody.Builder().apply { input.fields.forEach { add(it.name, it.value) } }.build()
            "multipart" -> {
                require(input.fields.isNotEmpty()) { "Add at least one multipart field" }
                MultipartBody.Builder().setType(MultipartBody.FORM).apply {
                    input.fields.forEach { field ->
                        require(field.name.isNotBlank() && field.name.none { it == '\r' || it == '\n' }) { "Invalid form field name" }
                        if (field.fileBase64 != null) {
                            val bytes = Base64.getDecoder().decode(field.fileBase64)
                            require(bytes.size <= MAX_BYTES) { "File exceeds 1 MiB" }
                            val filename = field.fileName ?: "upload"
                            require(filename.none { it == '\r' || it == '\n' }) { "Invalid filename" }
                            addFormDataPart(field.name, filename, bytes.toRequestBody((field.contentType ?: "application/octet-stream").toMediaTypeOrNull()))
                        } else addFormDataPart(field.name, field.value)
                    }
                }.build()
            }
            else -> if (input.method in setOf("POST", "PUT", "PATCH")) ByteArray(0).toRequestBody() else null
        }
        require(body == null || body.contentLength() <= MAX_BYTES) { "Request body exceeds 1 MiB" }
        return builder.method(input.method, body).build()
    }

    fun test(input: HttpTestRequest): HttpTestResponse {
        val request = try { assemble(input) } catch (_: Exception) {
            // Validation exception text can contain credentials from malformed URLs or headers.
            throw ApiError.ValidationError("Invalid HTTP request. Check the URL, method, headers, body format and 1 MiB size limit.")
        }
        if (!slots.tryAcquire()) throw ApiError.TooManyRequests("HTTP tester is busy. Try again shortly.")
        val start = System.nanoTime()
        fun elapsed() = (System.nanoTime() - start) / 1_000_000
        val bodySecrets = mutableListOf<String>()
        fun collect(node: com.fasterxml.jackson.databind.JsonNode) {
            if (node.isObject) node.fields().forEachRemaining { (name, value) ->
                if (sensitiveName.containsMatchIn(name) && value.isValueNode) bodySecrets += value.asText() else collect(value)
            } else if (node.isArray) node.forEach(::collect)
        }
        runCatching { mapper.readTree(input.body)?.let(::collect) }
        val querySecrets = request.url.queryParameterNames.filter { sensitiveName.containsMatchIn(it) }.flatMap { request.url.queryParameterValues(it).filterNotNull() }
        val secrets = (input.sensitiveValues + bodySecrets + querySecrets + input.headers.filter { it.secret || sensitiveName.containsMatchIn(it.name) }.map { it.value } +
            input.fields.filter { it.secret || sensitiveName.containsMatchIn(it.name) }.map { it.value }).filter { it.isNotEmpty() }
            .flatMap { listOf(it, java.net.URLEncoder.encode(it, Charsets.UTF_8), mapper.writeValueAsString(it).removeSurrounding("\"")) }
            .distinct().sortedByDescending { it.length }
        fun redact(value: String): String = secrets.fold(value) { text, secret -> text.replace(secret, "[REDACTED]") }
        return try {
            // Also covers literal IPs which OkHttp may not pass to its DNS resolver.
            SsrfGuard.resolvePublic(request.url.host)
            client.newBuilder().callTimeout(input.timeoutMs, TimeUnit.MILLISECONDS).build().newCall(request).execute().use { response ->
                val bytes = response.body?.byteStream()?.readNBytes(MAX_RESPONSE + 1) ?: ByteArray(0)
                val truncated = bytes.size > MAX_RESPONSE
                val contentType = response.body?.contentType()
                val text = if (contentType == null || contentType.type == "text" || contentType.subtype.contains("json") || contentType.subtype.contains("xml") || contentType.subtype.contains("javascript"))
                    String(bytes.take(MAX_RESPONSE).toByteArray(), contentType?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)
                else "[Binary response; ${bytes.size.coerceAtMost(MAX_RESPONSE)} bytes received]"
                HttpTestResponse(response.code, elapsed(), response.headers.toMultimap().mapValues { (name, values) ->
                    if (sensitiveName.containsMatchIn(name)) listOf("[REDACTED]") else values.map(::redact)
                }, redact(text), bytes.size.coerceAtMost(MAX_RESPONSE), truncated)
            }
        } catch (_: SsrfGuard.SsrfBlockedException) {
            HttpTestResponse(null, elapsed(), errorCode = "PRIVATE_HOST", message = "Private or local hosts require a private runner.")
        } catch (_: java.net.UnknownHostException) {
            HttpTestResponse(null, elapsed(), errorCode = "DNS_FAILED", message = "Could not resolve the API hostname.")
        } catch (_: javax.net.ssl.SSLException) {
            HttpTestResponse(null, elapsed(), errorCode = "TLS_FAILED", message = "TLS certificate or handshake failed.")
        } catch (_: java.io.InterruptedIOException) {
            HttpTestResponse(null, elapsed(), errorCode = "TIMEOUT", message = "The request timed out. The remote API may still have processed it.")
        } catch (_: Exception) {
            HttpTestResponse(null, elapsed(), errorCode = "CONNECTION_ERROR", message = "Could not complete the HTTP request.")
        } finally { slots.release() }
    }
}
