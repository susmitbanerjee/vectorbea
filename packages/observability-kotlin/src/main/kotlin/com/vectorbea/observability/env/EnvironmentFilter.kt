package com.vectorbea.observability.env

/** Allowed telemetry environments. */
enum class VectorbeaEnvironment(val value: String) {
    DEV("dev"),
    STAGE("stage"),
    PROD("prod");

    companion object {
        fun from(raw: String?): VectorbeaEnvironment? = when (raw?.lowercase()) {
            "dev"   -> DEV
            "stage" -> STAGE
            "prod"  -> PROD
            else    -> null
        }

        fun fromOrDefault(raw: String?, default: VectorbeaEnvironment = PROD): VectorbeaEnvironment =
            from(raw) ?: default
    }
}

/** Resolves the SQL fragment for environment filtering. */
object EnvironmentFilter {
    /**
     * Returns a SQL WHERE fragment for the environment column.
     * - "all" → no filter (admin-only paths)
     * - specific env → exact match
     */
    fun sqlFragment(envParam: String?, columnName: String = "environment"): Pair<String, List<String>> {
        return when (envParam?.lowercase()) {
            null, "all" -> "1=1" to emptyList()
            else -> {
                val env = VectorbeaEnvironment.from(envParam)
                    ?: return "1=1" to emptyList()
                "$columnName = ?" to listOf(env.value)
            }
        }
    }
}
