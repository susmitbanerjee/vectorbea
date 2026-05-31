package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class LlmFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        if (e.failedNodeType !in listOf("llm","agent") && e.provider == null && e.failedAgentId == null) return null
        val msg = e.errorMessage?.lowercase() ?: ""
        val errType = e.errorType?.lowercase() ?: ""
        val http = e.httpStatus ?: e.providerStatusCode
        return when {
            errType.contains("json") || msg.contains("invalid json") || msg.contains("json parse") || msg.contains("unterminated") ->
                mk(FailureCategory.LLM_OUTPUT_INVALID, "LLM_JSON_PARSE_FAILED", FailureSeverity.MEDIUM, true, "LLM output could not be parsed as JSON. Retry may succeed.")
            e.schemaValidationErrors.isNotEmpty() || (msg.contains("schema") && msg.contains("validation")) ->
                FailureClassification(FailureCategory.SCHEMA_VALIDATION_FAILURE, "LLM_SCHEMA_VALIDATION_FAILED", FailureSeverity.MEDIUM, false,
                    summary = "LLM output did not match the expected output schema.",
                    technicalSummary = e.schemaValidationErrors.joinToString("; ").take(300))
            msg.contains("context length") || msg.contains("max token") || msg.contains("context window") ->
                mk(FailureCategory.RESOURCE_LIMIT_EXCEEDED, "LLM_CONTEXT_LENGTH_EXCEEDED", FailureSeverity.HIGH, false, "Input exceeded model context window. Reduce prompt or input size.")
            http == 401 || msg.contains("invalid_api_key") ->
                mk(FailureCategory.AUTH_FAILURE, "LLM_AUTH_FAILED", FailureSeverity.HIGH, false, "LLM provider authentication failed. Rotate the API key.")
            http == 429 || msg.contains("rate limit") || msg.contains("rate_limit") ->
                mk(FailureCategory.RATE_LIMIT, "LLM_RATE_LIMIT", FailureSeverity.MEDIUM, true, "LLM rate limit exceeded. Retrying with backoff.")
            (http ?: 0) in 500..599 || msg.contains("provider error") ->
                mk(FailureCategory.NETWORK_FAILURE, "LLM_PROVIDER_ERROR", FailureSeverity.MEDIUM, true, "LLM provider server error. May be transient.")
            msg.contains("timeout") || msg.contains("timed out") ->
                mk(FailureCategory.TIMEOUT, "LLM_TIMEOUT", FailureSeverity.MEDIUM, true, "LLM provider request timed out.")
            msg.contains("content_policy") || (msg.contains("safety") && msg.contains("blocked")) ->
                mk(FailureCategory.LLM_OUTPUT_INVALID, "LLM_PROVIDER_BLOCKED", FailureSeverity.HIGH, false, "LLM provider blocked request due to content policy. Review the prompt.")
            else -> null
        }
    }
    private fun mk(cat: FailureCategory, code: String, sev: FailureSeverity, retry: Boolean, sum: String) =
        FailureClassification(cat, code, sev, retry, summary = sum)
}
