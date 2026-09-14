package com.vectorbea.api.http

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The public API hostname serves the run API and nothing else. */
class PublicHostGateTest {

    private val hosts = setOf("api.vectorbea.com", "devapi.vectorbea.com")
    private fun on(host: String, method: String, path: String, forwarded: String? = null) =
        PublicHostGate.allows(method, path, listOfNotNull(host, forwarded), hosts)

    @Test
    fun `the run api is reachable on the public host`() {
        assertTrue(on("api.vectorbea.com", "POST", "/api/workflows/7a1c/run"))
        assertTrue(on("devapi.vectorbea.com:443", "GET", "/api/runs/3f9c"))
        assertTrue(on("api.vectorbea.com", "POST", "/api/hooks/tok_abc"))
        assertTrue(on("api.vectorbea.com", "POST", "/api/tool-callbacks/tok_abc"))
        assertTrue(on("api.vectorbea.com", "GET", "/api/delivery-payloads/dpl_abc"))
        assertTrue(on("api.vectorbea.com", "GET", "/healthz"))
        assertTrue(on("api.vectorbea.com", "OPTIONS", "/api/workflows/7a1c/run"), "a browser preflight for the run call")
    }

    @Test
    fun `everything else is refused on the public host`() {
        assertFalse(on("api.vectorbea.com", "GET", "/api/workflows"))
        assertFalse(on("api.vectorbea.com", "GET", "/api/runs"), "listing runs is not the run api")
        assertFalse(on("api.vectorbea.com", "GET", "/api/runs/3f9c/trace"))
        assertFalse(on("api.vectorbea.com", "GET", "/api/workflows/7a1c/run"), "wrong method")
        assertFalse(on("api.vectorbea.com", "GET", "/api/connections"))
        assertFalse(on("api.vectorbea.com", "POST", "/api/api-keys"))
        assertFalse(on("api.vectorbea.com", "POST", "/api/mcp/oauth/complete"))
        assertFalse(on("API.VECTORBEA.COM", "GET", "/api/workspaces/members"), "host matching is case-insensitive")
    }

    @Test
    fun `other hosts are untouched`() {
        assertTrue(on("vectorbea-api-production.up.railway.app", "GET", "/api/connections"))
        assertTrue(on("localhost:8080", "POST", "/api/api-keys"))
    }

    @Test
    fun `a forwarded public host cannot be hidden behind a private Host header`() {
        assertFalse(on("vectorbea-api-production.up.railway.app", "GET", "/api/connections", forwarded = "api.vectorbea.com"))
        assertFalse(on("vectorbea-api-production.up.railway.app", "GET", "/api/connections", forwarded = "evil.example, api.vectorbea.com"))
    }

    @Test
    fun `loopback is never treated as public, even when it is the derived public base`() {
        val derived = PublicHostGate.hostsFrom(mapOf("PORT" to "8080")::get)
        assertFalse("localhost" in derived)
        assertTrue("api.vectorbea.com" in derived)
    }
}
