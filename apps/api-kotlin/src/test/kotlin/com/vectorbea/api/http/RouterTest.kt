package com.vectorbea.api.http

import com.vectorbea.api.errors.ApiError
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class RouterTest {

    private fun makeRequest(method: String, path: String) = Request(
        method = method,
        path = path,
        requestId = "test-req-id",
    )

    @Test
    fun `exact path matches correctly`() {
        val router = Router()
        router.get("/health") { Response.ok(mapOf("status" to "ok")) }

        val resp = router.dispatch(makeRequest("GET", "/health"))
        assertEquals(200, resp.status)
    }

    @Test
    fun `path parameter is extracted`() {
        val router = Router()
        router.get("/workflows/:id") { req ->
            Response.ok(mapOf("id" to req.pathParam("id")))
        }

        val resp = router.dispatch(makeRequest("GET", "/workflows/abc-123"))
        assertEquals(200, resp.status)
        assert(resp.body.contains("abc-123"))
    }

    @Test
    fun `multiple path parameters are extracted`() {
        val router = Router()
        router.get("/workflows/:workflowId/runs/:runId") { req ->
            Response.ok(mapOf(
                "workflowId" to req.pathParam("workflowId"),
                "runId" to req.pathParam("runId"),
            ))
        }

        val resp = router.dispatch(makeRequest("GET", "/workflows/wf-1/runs/run-99"))
        assertEquals(200, resp.status)
        assert(resp.body.contains("wf-1"))
        assert(resp.body.contains("run-99"))
    }

    @Test
    fun `unknown path throws NotFound`() {
        val router = Router()
        router.get("/health") { Response.ok(emptyMap<String, String>()) }

        assertThrows<ApiError.NotFound> {
            router.dispatch(makeRequest("GET", "/nonexistent"))
        }
    }

    @Test
    fun `wrong method throws MethodNotAllowed`() {
        val router = Router()
        router.get("/health") { Response.ok(emptyMap<String, String>()) }

        assertThrows<ApiError.MethodNotAllowed> {
            router.dispatch(makeRequest("POST", "/health"))
        }
    }

    @Test
    fun `allowedMethods returns registered methods for path`() {
        val router = Router()
        router.get("/items") { Response.ok(emptyMap<String, String>()) }
        router.post("/items") { Response.created(emptyMap<String, String>()) }

        val methods = router.allowedMethods("/items")
        assert("GET" in methods)
        assert("POST" in methods)
    }

    @Test
    fun `longer literal path does not match shorter pattern`() {
        val router = Router()
        router.get("/health") { Response.ok(emptyMap<String, String>()) }

        assertThrows<ApiError.NotFound> {
            router.dispatch(makeRequest("GET", "/health/extra"))
        }
    }

    @Test
    fun `routes with same path prefix do not conflict`() {
        val router = Router()
        router.get("/runs") { Response.ok(mapOf("all" to true)) }
        router.get("/runs/:id") { req -> Response.ok(mapOf("id" to req.pathParam("id"))) }

        val listResp = router.dispatch(makeRequest("GET", "/runs"))
        val detailResp = router.dispatch(makeRequest("GET", "/runs/my-run"))

        assertEquals(200, listResp.status)
        assert(listResp.body.contains("all"))
        assertEquals(200, detailResp.status)
        assert(detailResp.body.contains("my-run"))
    }
}
