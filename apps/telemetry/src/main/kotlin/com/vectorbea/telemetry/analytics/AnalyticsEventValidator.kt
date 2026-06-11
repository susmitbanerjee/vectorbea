package com.vectorbea.telemetry.analytics

import com.vectorbea.telemetry.env.VectorbeaEnvironment
import com.vectorbea.telemetry.events.EventCategory
import com.vectorbea.telemetry.events.EventNames

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
