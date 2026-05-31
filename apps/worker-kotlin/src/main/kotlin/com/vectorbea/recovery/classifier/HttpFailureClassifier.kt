package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class HttpFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg = e.errorMessage?.lowercase() ?: ""
        val status = e.httpStatus ?: e.providerStatusCode
        if (status == null) return when {
            msg.contains("dns") || msg.contains("unknown host") -> mk(FailureCategory.NETWORK_FAILURE, "DNS_FAILED", FailureSeverity.HIGH, true, "DNS resolution failed.")
            msg.contains("tls") || msg.contains("ssl") || msg.contains("certificate") -> mk(FailureCategory.NETWORK_FAILURE, "TLS_FAILED", FailureSeverity.HIGH, false, "TLS/SSL handshake failed.")
            msg.contains("connection refused") -> mk(FailureCategory.NETWORK_FAILURE, "CONNECTION_REFUSED", FailureSeverity.MEDIUM, true, "Connection refused by target host.")
            msg.contains("timeout") || msg.contains("timed out") -> mk(FailureCategory.TIMEOUT, "HTTP_TIMEOUT", FailureSeverity.MEDIUM, true, "HTTP request timed out.")
            else -> null
        }
        return when {
            status == 400 -> mk(FailureCategory.TOOL_RESPONSE_INVALID, "HTTP_400", FailureSeverity.MEDIUM, false, "Bad request: server rejected the request parameters.")
            status == 401 -> mk(FailureCategory.AUTH_FAILURE, "HTTP_401", FailureSeverity.HIGH, false, "Unauthorized: credentials missing or invalid.")
            status == 403 -> mk(FailureCategory.AUTH_FAILURE, "HTTP_403", FailureSeverity.HIGH, false, "Forbidden: insufficient permissions.")
            status == 404 -> mk(FailureCategory.TOOL_RESPONSE_INVALID, "HTTP_404", FailureSeverity.MEDIUM, false, "Not found: target URL does not exist.")
            status == 408 -> mk(FailureCategory.TIMEOUT, "HTTP_408", FailureSeverity.MEDIUM, true, "Request timeout.")
            status == 409 -> mk(FailureCategory.TOOL_RESPONSE_INVALID, "HTTP_409", FailureSeverity.MEDIUM, false, "Conflict: resource state conflict.")
            status == 422 -> mk(FailureCategory.TOOL_RESPONSE_INVALID, "HTTP_422", FailureSeverity.MEDIUM, false, "Unprocessable entity: validation error in request body.")
            status == 429 -> mk(FailureCategory.RATE_LIMIT, "HTTP_429", FailureSeverity.MEDIUM, true, "Rate limit exceeded. Retrying with backoff.")
            status != null && status in 500..599 -> mk(FailureCategory.NETWORK_FAILURE, "HTTP_5XX", FailureSeverity.MEDIUM, true, "Provider server error (HTTP $status). May be transient.")
            else -> null
        }
    }
    private fun mk(cat: FailureCategory, code: String, sev: FailureSeverity, retry: Boolean, sum: String) =
        FailureClassification(cat, code, sev, retry, summary = sum)
}
