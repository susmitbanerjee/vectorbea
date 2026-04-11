package com.vectorbea.api.http

object RoutePattern {
    fun matches(pattern: String, path: String): Boolean {
        val patternSegments = pattern.trim('/').split('/').filter { it.isNotEmpty() }
        val pathSegments = path.trim('/').split('/').filter { it.isNotEmpty() }

        if (patternSegments.size != pathSegments.size) {
            return false
        }

        return patternSegments.zip(pathSegments).all { (expected, actual) ->
            expected.startsWith(":") || expected == actual
        }
    }
}
