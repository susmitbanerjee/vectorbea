package com.vectorbea.api.auth

import com.vectorbea.api.http.Request
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A browser's EventSource cannot send a header, so the run streams take the
 * session token from `?access_token=` — on those routes only.
 */
class StreamQueryTokenTest {

    private fun get(path: String, token: String?) = Request(
        method = "GET",
        path = path,
        queryParams = token?.let { mapOf("access_token" to it) } ?: emptyMap(),
    )

    @Test
    fun `the run and trace streams accept the token from the query string`() {
        assertEquals("jwt", AuthMiddleware.streamQueryToken(get("/api/runs/1d31671a-dd3e/stream", "jwt")))
        assertEquals("jwt", AuthMiddleware.streamQueryToken(get("/api/runs/1d31671a-dd3e/trace/stream", "jwt")))
    }

    @Test
    fun `no other route, method or credential does`() {
        assertNull(AuthMiddleware.streamQueryToken(get("/api/runs/1d31671a-dd3e/events", "jwt")))
        assertNull(AuthMiddleware.streamQueryToken(get("/api/workflows", "jwt")))
        assertNull(AuthMiddleware.streamQueryToken(get("/api/runs/x/stream/extra", "jwt")))
        assertNull(AuthMiddleware.streamQueryToken(Request(method = "POST", path = "/api/runs/x/stream", queryParams = mapOf("access_token" to "jwt"))))
        assertNull(AuthMiddleware.streamQueryToken(get("/api/runs/x/stream", "vb_live_key")), "an API key never rides in a URL")
        assertNull(AuthMiddleware.streamQueryToken(get("/api/runs/x/stream", "  ")))
    }
}
