package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class ConnectionFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val status = e.connectionStatus?.lowercase()
        val net = e.connectionNetworkStatus?.lowercase()
        val code = e.errorCode?.lowercase() ?: ""
        val msg = e.errorMessage?.lowercase() ?: ""
        return when {
            status == "missing_secret" || code == "secret_missing" || (msg.contains("secret") && msg.contains("missing")) ->
                mk(FailureCategory.AUTH_FAILURE, "SECRET_MISSING", FailureSeverity.HIGH, false, "The connection secret is missing or not configured.")
            status == "needs_whitelist" || net == "whitelist_required" || code == "whitelist_required" ->
                mk(FailureCategory.NETWORK_FAILURE, "WHITELIST_REQUIRED", FailureSeverity.HIGH, false, "Vectorbea cannot reach this connection until outbound IPs are whitelisted.")
            net == "private" || code == "private_runner_required" || msg.contains("private runner") ->
                mk(FailureCategory.NETWORK_FAILURE, "PRIVATE_RUNNER_REQUIRED", FailureSeverity.HIGH, false, "This target requires a Vectorbea private runner.")
            status == "disabled" || code == "connection_disabled" ->
                mk(FailureCategory.CONNECTION_FAILURE, "CONNECTION_DISABLED", FailureSeverity.HIGH, false, "The connection is disabled. Enable it in Connection Settings.")
            status == "failed" && (msg.contains("unreachable") || msg.contains("refused")) ->
                mk(FailureCategory.NETWORK_FAILURE, "CONNECTION_UNREACHABLE", FailureSeverity.MEDIUM, true, "Connection endpoint unreachable. May be transient.")
            (status == "failed" || code.contains("auth")) && (msg.contains("authentication") || msg.contains("credential")) ->
                mk(FailureCategory.AUTH_FAILURE, "AUTH_FAILED", FailureSeverity.HIGH, false, "Authentication to the connection failed. Check credentials.")
            else -> null
        }
    }
    private fun mk(cat: FailureCategory, code: String, sev: FailureSeverity, retry: Boolean, sum: String) =
        FailureClassification(cat, code, sev, retry, summary = sum)
}
