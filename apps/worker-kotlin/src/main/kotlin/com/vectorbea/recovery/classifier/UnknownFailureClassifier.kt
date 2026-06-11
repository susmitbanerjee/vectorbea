package com.vectorbea.recovery.classifier

import com.vectorbea.recovery.model.*

class UnknownFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification =
        FailureClassification(
            category = FailureCategory.UNKNOWN, code = "UNKNOWN",
            severity = FailureSeverity.MEDIUM, retryable = false, confidence = 0.3,
            summary = "An unexpected error occurred. Manual investigation is recommended.",
            technicalSummary = e.errorMessage?.take(500),
            evidence = buildMap {
                e.errorCode?.let { put("errorCode", it) }
                e.errorType?.let { put("errorType", it) }
                e.httpStatus?.let { put("httpStatus", it) }
            })
}
