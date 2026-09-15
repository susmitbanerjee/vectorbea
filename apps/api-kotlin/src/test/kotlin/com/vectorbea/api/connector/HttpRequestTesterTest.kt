package com.vectorbea.api.connector

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertContains
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HttpRequestTesterTest {
    private val tester = HttpRequestTester()
    @Test fun `POST preserves JSON custom headers and query parameters`() {
        val request = tester.assemble(HttpTestRequest("POST", "https://example.com/search?flag=false&flag=true",
            listOf(HttpTestField("apy_token", "fixture", true)), "json", """{"source":"ing","target":"finding things bring"}"""))
        assertEquals(listOf("false", "true"), request.url.queryParameterValues("flag"))
        assertEquals("fixture", request.header("apy_token"))
        assertContains(request.body!!.contentType().toString(), "application/json")
        val buffer = Buffer(); request.body!!.writeTo(buffer)
        assertContains(buffer.readUtf8(), "finding things bring")
    }
    @Test fun `multipart owns its boundary and supports binary files`() {
        val request = tester.assemble(HttpTestRequest("POST", "https://example.com", listOf(HttpTestField("Content-Type", "multipart/form-data")),
            "multipart", fields = listOf(HttpTestField("source", "ing"), HttpTestField("file", fileName = "test.txt", fileBase64 = "aGVsbG8=", contentType = "text/plain"))))
        assertEquals(null, request.header("Content-Type"))
        assertContains(request.body!!.contentType().toString(), "boundary=")
        val buffer = Buffer(); request.body!!.writeTo(buffer)
        val wire = buffer.readUtf8()
        assertContains(wire, "filename=\"test.txt\"")
        assertContains(wire, "hello")
    }
    @Test fun `rejects GET bodies transport headers invalid JSON and oversized data`() {
        for (input in listOf(
            HttpTestRequest("GET", "https://example.com", bodyType = "json", body = "{}"),
            HttpTestRequest("POST", "https://example.com", bodyType = "json", body = "{"),
            HttpTestRequest(url = "https://user:secret@example.com"),
            HttpTestRequest(url = "https://example.com", headers = listOf(HttpTestField("Host", "internal"))),
            HttpTestRequest(url = "https://example.com", headers = listOf(HttpTestField("X-Test", "a\r\nb"))),
            HttpTestRequest("POST", "https://example.com", bodyType = "raw", body = "x".repeat(HttpRequestTester.MAX_BYTES + 1)),
        )) assertFailsWith<IllegalArgumentException> { tester.assemble(input) }
    }
    @Test fun `private destinations are blocked before sending`() {
        for (host in listOf("127.0.0.1", "169.254.169.254", "100.64.0.1", "[fd00::1]")) {
            assertEquals("PRIVATE_HOST", tester.test(HttpTestRequest(url = "http://$host")).errorCode)
        }
    }
    @Test fun `redacts secrets echoed in errors and response headers`() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(401).message("Unauthorized")
                .header("Set-Cookie", "session=fixture-token").header("X-Echo", "fixture-token")
                .body("fixture-token query-secret body-secret".toResponseBody()).build()
        }.build()
        val result = HttpRequestTester(client).test(HttpTestRequest("POST", "https://93.184.216.34/?api_token=query-secret",
            headers = listOf(HttpTestField("apy_token", "fixture-token")), bodyType = "json", body = """{"password":"body-secret"}"""))
        assertEquals(401, result.status)
        assertFalse(result.body.contains("fixture-token"))
        assertFalse(result.body.contains("query-secret"))
        assertFalse(result.body.contains("body-secret"))
        assertTrue(result.headers.values.flatten().all { !it.contains("fixture-token") })
    }
    @Test fun `caps response bodies and reports truncation`() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body("x".repeat(HttpRequestTester.MAX_RESPONSE + 100).toResponseBody()).build()
        }.build()
        val result = HttpRequestTester(client).test(HttpTestRequest(url = "https://93.184.216.34"))
        assertTrue(result.truncated)
        assertEquals(HttpRequestTester.MAX_RESPONSE, result.sizeBytes)
    }
}
