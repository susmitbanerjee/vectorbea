package com.vectorbea.sdk

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A resolved, published prompt version fetched from the VectorBea proxy.
 *
 * ```kotlin
 * val prompt  = client.getPrompt("greet-user")
 * val message = prompt.compile(mapOf("name" to "Alice", "product" to "Acme AI"))
 * // → "Hello Alice, welcome to Acme AI!"
 * ```
 */
@Serializable
data class Prompt(
    /** Prompt name as registered in the dashboard (e.g. `"greet-user"`). */
    @SerialName("name")
    val name: String,

    /** Human-readable version label (e.g. `"v1.2.0"`). */
    @SerialName("versionTag")
    val versionTag: String,

    /** Raw template string with `{{variable}}` placeholders. */
    @SerialName("templateText")
    val templateText: String,

    /** Parameter schema defined in the dashboard, keyed by variable name. */
    @SerialName("parameters")
    val parameters: Map<String, String> = emptyMap(),

    /** Optional human-readable description of the prompt's purpose. */
    @SerialName("description")
    val description: String? = null,

    /** ISO-8601 timestamp of when this version was created. */
    @SerialName("createdAt")
    val createdAt: String = "",

    /** Internal prompt version id used for tracing and audit correlation. */
    @SerialName("promptVersionId")
    val promptVersionId: String = "",

    /** Prompt id returned by the VectorBea API when available. */
    @SerialName("promptId")
    val promptId: String = "",

    /** Workspace/organization id returned by older API payloads when available. */
    @SerialName("organizationId")
    val organizationId: String = "",
)

@Serializable
internal data class RawPrompt(
    @SerialName("promptId")
    val promptId: String = "",
    @SerialName("promptVersionId")
    val promptVersionId: String,
    @SerialName("organizationId")
    val organizationId: String = "",
    @SerialName("name")
    val name: String,
    @SerialName("versionTag")
    val versionTag: String,
    @SerialName("templateText")
    val templateText: String,
    @SerialName("parameters")
    val parameters: Map<String, String> = emptyMap(),
    @SerialName("description")
    val description: String? = null,
    @SerialName("createdAt")
    val createdAt: String = "",
) {
    fun toPrompt(): Prompt = Prompt(
        name = name,
        versionTag = versionTag,
        templateText = templateText,
        parameters = parameters,
        description = description,
        createdAt = createdAt,
        promptVersionId = promptVersionId,
        promptId = promptId,
        organizationId = organizationId,
    )
}

// ── Extension functions ───────────────────────────────────────────────────────

private val PLACEHOLDER_RE = Regex("""\{\{\s*(\w+)\s*\}\}""")

/**
 * Render the template by substituting `{{variable}}` placeholders.
 *
 * All `{{key}}` occurrences in [Prompt.templateText] are replaced with the
 * corresponding value from [variables]. Whitespace inside the braces is
 * ignored, so `{{ name }}` and `{{name}}` are equivalent.
 *
 * @param variables Mapping of placeholder names to their substitution values.
 * @return Fully rendered prompt string ready to send to an LLM.
 * @throws IllegalArgumentException if a placeholder has no matching key.
 *
 * ```kotlin
 * val message = prompt.compile(mapOf("name" to "Bob", "product" to "VectorBea"))
 * // → "Hello Bob, welcome to VectorBea!"
 * ```
 */
fun Prompt.compile(variables: Map<String, String>): String {
    val missing = PLACEHOLDER_RE
        .findAll(templateText)
        .map { it.groupValues[1] }
        .filterNot { it in variables }
        .toList()

    if (missing.isNotEmpty()) {
        throw IllegalArgumentException(
            "Missing template variables: $missing. " +
                "Provide them as keys in the map passed to compile()."
        )
    }

    return PLACEHOLDER_RE.replace(templateText) { match ->
        variables[match.groupValues[1]]!!
    }
}
