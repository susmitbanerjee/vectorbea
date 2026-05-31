package com.vectorbea.recovery.classifier

import com.vectorbea.recovery.model.FailureClassification
import com.vectorbea.recovery.model.FailureEvidence

interface SpecificFailureClassifier {
    fun classify(evidence: FailureEvidence): FailureClassification?
}
