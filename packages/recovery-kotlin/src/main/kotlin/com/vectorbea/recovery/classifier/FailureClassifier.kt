package com.vectorbea.recovery.classifier

import com.vectorbea.recovery.model.FailureClassification
import com.vectorbea.recovery.model.FailureEvidence

class FailureClassifier(
    private val classifiers: List<SpecificFailureClassifier> = defaultChain(),
) {
    fun classify(evidence: FailureEvidence): FailureClassification =
        classifiers.firstNotNullOf { it.classify(evidence) }

    companion object {
        fun defaultChain(): List<SpecificFailureClassifier> = listOf(
            ConnectionFailureClassifier(),
            HttpFailureClassifier(),
            DbFailureClassifier(),
            LlmFailureClassifier(),
            MappingFailureClassifier(),
            ApprovalFailureClassifier(),
            WorkerFailureClassifier(),
            UnknownFailureClassifier(),
        )
    }
}
