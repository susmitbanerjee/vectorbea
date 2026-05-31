package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class MappingFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg = e.errorMessage?.lowercase() ?: ""
        val code = e.errorCode?.lowercase() ?: ""
        val hasMapping = e.mappingErrors.isNotEmpty()
        if (!hasMapping && !msg.contains("mapping") && !msg.contains("template") &&
            !msg.contains("steps.") && code != "mapping_failed" && !msg.contains("{{")) return null
        return when {
            (hasMapping && e.mappingErrors.any { it.lowercase().contains("not found") }) || msg.contains("path not found") ->
                FailureClassification(FailureCategory.MAPPING_FAILURE, "JSON_PATH_NOT_FOUND", FailureSeverity.MEDIUM, false,
                    summary = "Input mapping failed: JSON path not found in step output.",
                    technicalSummary = e.mappingErrors.firstOrNull())
            msg.contains("future step") || msg.contains("not yet completed") ->
                mk("INVALID_FUTURE_STEP_REFERENCE", "Mapping references a step that has not yet completed.")
            msg.contains("unknown step") || msg.contains("step not found") ->
                mk("UNKNOWN_STEP_REFERENCE", "Mapping references a step that does not exist in this workflow.")
            msg.contains("type mismatch") || msg.contains("cannot convert") ->
                mk("MAPPING_TYPE_MISMATCH", "Mapping produced a value of the wrong type.")
            msg.contains("template") || msg.contains("{{") ->
                FailureClassification(FailureCategory.MAPPING_FAILURE, "TEMPLATE_RENDER_FAILED", FailureSeverity.MEDIUM, false,
                    summary = "Template expression failed to render.", technicalSummary = e.errorMessage?.take(300))
            else -> null
        }
    }
    private fun mk(code: String, sum: String) =
        FailureClassification(FailureCategory.MAPPING_FAILURE, code, FailureSeverity.MEDIUM, false, summary = sum)
}
