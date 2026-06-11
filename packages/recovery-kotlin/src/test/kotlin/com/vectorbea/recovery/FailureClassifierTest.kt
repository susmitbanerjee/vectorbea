package com.vectorbea.recovery

import com.vectorbea.recovery.classifier.FailureClassifier
import com.vectorbea.recovery.model.*
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FailureClassifierTest {
    private val c = FailureClassifier()
    private fun ev(httpStatus: Int? = null, dbSqlState: String? = null, errorMessage: String? = null,
        errorCode: String? = null, errorType: String? = null, nodeType: String? = null,
        connStatus: String? = null, connNet: String? = null, eventType: String? = null,
        schemaErrors: List<String> = emptyList(), mappingErrors: List<String> = emptyList(),
        agentId: String? = null,
    ) = FailureEvidence("ws1","env1","run1","wf1","ver1",
        failedNodeType = nodeType, httpStatus = httpStatus, dbSqlState = dbSqlState,
        errorMessage = errorMessage, errorCode = errorCode, errorType = errorType,
        connectionStatus = connStatus, connectionNetworkStatus = connNet, eventType = eventType,
        schemaValidationErrors = schemaErrors, mappingErrors = mappingErrors, failedAgentId = agentId)

    @Test fun http401() { val r = c.classify(ev(httpStatus=401)); assertEquals(FailureCategory.AUTH_FAILURE,r.category); assertEquals("HTTP_401",r.code) }
    @Test fun http403() { val r = c.classify(ev(httpStatus=403)); assertEquals(FailureCategory.AUTH_FAILURE,r.category); assertEquals("HTTP_403",r.code) }
    @Test fun http429() { val r = c.classify(ev(httpStatus=429)); assertEquals(FailureCategory.RATE_LIMIT,r.category); assertTrue(r.retryable) }
    @Test fun http500() { val r = c.classify(ev(httpStatus=500)); assertEquals(FailureCategory.NETWORK_FAILURE,r.category); assertTrue(r.retryable) }
    @Test fun dbTableNotFound() { val r = c.classify(ev(dbSqlState="42P01")); assertEquals("DB_TABLE_NOT_FOUND",r.code) }
    @Test fun dbColumnNotFound() { val r = c.classify(ev(dbSqlState="42703")); assertEquals("DB_COLUMN_NOT_FOUND",r.code) }
    @Test fun dbUniqueConstraint() { val r = c.classify(ev(dbSqlState="23505")); assertEquals("DB_UNIQUE_CONSTRAINT",r.code) }
    @Test fun llmJsonParseFailed() {
        val r = c.classify(ev(nodeType="llm", errorType="JsonParseException", errorMessage="invalid json at pos 42"))
        assertEquals(FailureCategory.LLM_OUTPUT_INVALID,r.category); assertEquals("LLM_JSON_PARSE_FAILED",r.code); assertTrue(r.retryable)
    }
    @Test fun llmSchemaValidation() {
        val r = c.classify(ev(nodeType="agent", schemaErrors=listOf("field required"), agentId="ag1"))
        assertEquals(FailureCategory.SCHEMA_VALIDATION_FAILURE,r.category)
    }
    @Test fun mappingPathMissing() {
        val r = c.classify(ev(errorMessage="path not found", mappingErrors=listOf("steps.x.output.id not found")))
        assertEquals(FailureCategory.MAPPING_FAILURE,r.category); assertEquals("JSON_PATH_NOT_FOUND",r.code)
    }
    @Test fun secretMissing() { val r = c.classify(ev(connStatus="missing_secret")); assertEquals("SECRET_MISSING",r.code) }
    @Test fun whitelistRequired() { val r = c.classify(ev(connNet="whitelist_required")); assertEquals("WHITELIST_REQUIRED",r.code) }
    @Test fun workerCrash() { val r = c.classify(ev(errorCode="worker_crashed")); assertEquals(FailureCategory.WORKER_CRASHED,r.category) }
    @Test fun approvalRejected() { val r = c.classify(ev(eventType="APPROVAL_REJECTED")); assertEquals(FailureCategory.APPROVAL_REJECTED,r.category) }
    @Test fun unknown() { val r = c.classify(ev(errorMessage="weird")); assertEquals(FailureCategory.UNKNOWN,r.category) }
}
