package com.vectorbea.api.api

/**
 * Converts a human-readable name to a URL-safe slug.
 *
 * Examples:
 *   "My Connection" → "my-connection"
 *   "OpenAI (GPT-4)" → "openai-gpt-4"
 *   "DB   Writer  Tool" → "db-writer-tool"
 */
fun slugify(name: String): String =
    name.lowercase()
        .replace(Regex("[^a-z0-9\\s-]"), "")   // strip special chars
        .replace(Regex("\\s+"), "-")             // spaces → hyphens
        .replace(Regex("-{2,}"), "-")            // collapse multiple hyphens
        .trim('-')
        .take(64)
        .ifBlank { "item" }

/**
 * Ensures a slug is unique within a given existing set by appending a counter suffix.
 *
 * Usage:
 *   uniqueSlug("my-conn", existingSlugs) // → "my-conn", "my-conn-2", "my-conn-3" ...
 */
fun uniqueSlug(base: String, existingSlugs: Set<String>): String {
    if (base !in existingSlugs) return base
    var n = 2
    while (true) {
        val candidate = "$base-$n"
        if (candidate !in existingSlugs) return candidate
        n++
        if (n > 1000) return "$base-${System.currentTimeMillis()}"
    }
}
