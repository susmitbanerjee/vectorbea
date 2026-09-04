package com.vectorbea.observability.analytics

import com.vectorbea.observability.env.VectorbeaEnvironment
import com.vectorbea.observability.events.EventCategory
import com.vectorbea.observability.events.EventNames

data class ValidationResult(val valid: Boolean, val errors: List<String> = emptyList())

object AnalyticsEventValidator {
    fun validate(req: IngestEventRequest, configEnv: String): ValidationResult {
        val errors = mutableListOf<String>()

        if (req.eventName.isBlank()) errors += "eventName is required"
        if (req.eventCategory.isBlank()) errors += "eventCategory is required"

        val category = EventCategory.from(req.eventCategory)
        if (category == null) {
            errors += "unknown eventCategory: ${req.eventCategory}"
        } else {
            if (!EventNames.isValid(category, req.eventName)) {
                errors += "unknown eventName '${req.eventName}' for category '${req.eventCategory}'"
            }
        }

        val env = req.environment ?: configEnv
        if (VectorbeaEnvironment.from(env) == null) {
            errors += "environment must be dev, stage, or prod — got: $env"
        }

        return ValidationResult(errors.isEmpty(), errors)
    }
}
