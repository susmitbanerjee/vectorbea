package com.vectorbea.api.http

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.errors.ErrorResponse
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class ErrorResponseTest {

    @Test
    fun `ErrorResponse serializes to correct JSON shape`() {
        val er = ErrorResponse.of("NOT_FOUND", "Workflow not found", "req-abc")
        val json = toJson(er)
        val parsed = fromJson<Map<String, Any>>(json)

        // Top-level key must be "error"
        assertNotNull(parsed["error"])
        val error = parsed["error"] as Map<*, *>
        assertEquals("NOT_FOUND", error["code"])
        assertEquals("Workflow not found", error["message"])
        assertEquals("req-abc", error["requestId"])
    }

    @Test
    fun `fromApiError maps NotFound correctly`() {
        val err = ApiError.NotFound("Workflow")
        val er = ErrorResponse.fromApiError(err, "req-123")

        assertEquals("NOT_FOUND", er.error.code)
        assertEquals("Workflow not found", er.error.message)
        assertEquals("req-123", er.error.requestId)
    }

    @Test
    fun `fromApiError maps ValidationError correctly`() {
        val err = ApiError.ValidationError("Name is required")
        val er = ErrorResponse.fromApiError(err, "req-456")

        assertEquals("VALIDATION_ERROR", er.error.code)
        assertEquals("Name is required", er.error.message)
    }

    @Test
    fun `internalError uses generic message`() {
        val er = ErrorResponse.internalError("req-789")
        assertEquals("INTERNAL_ERROR", er.error.code)
        assertEquals("An internal error occurred", er.error.message)
    }

    @Test
    fun `Response fromApiError produces correct HTTP status`() {
        val err = ApiError.NotFound("Run")
        val response = Response.fromApiError(err, "req-000")
        assertEquals(404, response.status)
    }

    @Test
    fun `Response fromApiError for ValidationError is 400`() {
        val err = ApiError.ValidationError("bad input")
        val response = Response.fromApiError(err, "req-001")
        assertEquals(400, response.status)
    }

    @Test
    fun `Response fromApiError for InternalError is 500`() {
        val err = ApiError.InternalError()
        val response = Response.fromApiError(err, "req-002")
        assertEquals(500, response.status)
    }

    @Test
    fun `error response body never contains stack trace`() {
        val err = ApiError.NotFound("Widget")
        val response = Response.fromApiError(err, "req-003")
        // Stack trace indicators must not appear
        assert(!response.body.contains("Exception"))
        assert(!response.body.contains("at com."))
        assert(!response.body.contains("StackTrace"))
    }
}
