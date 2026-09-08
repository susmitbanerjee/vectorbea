package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode

/**
 * `{{ name }}` substitution, with the smallest vocabulary that does the job.
 *
 * ── WHY A NEW ONE AND NOT THE WORKFLOW'S EXPRESSION LANGUAGE ────────────────
 * The workflow's resolver answers "what did the previous step produce" and can
 * reach across the whole run. That is exactly the wrong power here. A tool spec
 * is rendered against a MODEL'S arguments and a CONNECTION'S secrets, and those
 * are two closed sets. A template that could also reach a sibling node's output
 * would let a tool's request body be steered by data the tool's author never
 * saw, which is a data-exfiltration shape rather than a feature.
 *
 * So the vocabulary is: the declared inputs, by name, plus whatever extra
 * bindings the caller explicitly passes (the HMAC signer's `{{timestamp}}`, the
 * auth layer's `{{secret.<field>}}`). Nothing resolves implicitly.
 *
 * ── A MISSING NAME IS AN ERROR, NOT AN EMPTY STRING ─────────────────────────
 * Leaving `{{customerId}}` in a URL produces a vendor 404, and a vendor 404 is
 * the least informative way to discover that an input was not mapped. Rendering
 * it as empty produces a request for the wrong resource, which is worse. Both
 * are silent; [MissingBinding] is not.
 */
internal object SpecTemplate {

    private val mapper = ObjectMapper()

    /** `{{ name }}` or `{{name}}`; also `{name}`, which is OpenAPI's path form. */
    private val DOUBLE = Regex("""\{\{\s*([A-Za-z_][A-Za-z0-9_.\-]*)\s*}}""")
    private val SINGLE = Regex("""\{\s*([A-Za-z_][A-Za-z0-9_.\-]*)\s*}""")

    class MissingBinding(val name: String) : Exception("No value for '$name'")

    /**
     * Render [template], substituting `{{name}}` from [bindings].
     *
     * [encode] is applied to every substituted value — path segments are
     * percent-encoded, JSON string bodies are JSON-escaped, form values are form
     * encoded. Encoding at substitution rather than afterwards is what stops a
     * value containing `&`, `"` or `../` from restructuring the thing it was
     * substituted into. That is the whole of the injection surface here.
     */
    fun render(
        template: String,
        bindings: Map<String, Any?>,
        encode: (String) -> String = { it },
        strict: Boolean = true,
    ): String {
        if (!template.contains('{')) return template
        val afterDouble = DOUBLE.replace(template) { m ->
            encode(lookup(m.groupValues[1], bindings, strict))
        }
        return SINGLE.replace(afterDouble) { m ->
            encode(lookup(m.groupValues[1], bindings, strict))
        }
    }

    /** Placeholder names appearing in [template], in order of appearance. */
    fun placeholders(template: String): List<String> =
        (DOUBLE.findAll(template).map { it.groupValues[1] } +
            SINGLE.findAll(template).map { it.groupValues[1] }).distinct().toList()

    private fun lookup(name: String, bindings: Map<String, Any?>, strict: Boolean): String {
        if (bindings.containsKey(name)) return stringify(bindings[name])

        /*
         * A dotted name resolves INTO a bound value: `{{secret.clientSecret}}`
         * and `{{customer.email}}`. Only one level of container walking, and only
         * into maps and JSON objects — a template is not a query language, and
         * the moment it can index arrays it becomes a second one beside the
         * workflow's.
         */
        if (name.contains('.')) {
            val head = name.substringBefore('.')
            val rest = name.substringAfter('.')
            val root = bindings[head]
            val v = walk(root, rest)
            if (v != null) return stringify(v)
        }
        if (strict) throw MissingBinding(name)
        return ""
    }

    private fun walk(root: Any?, path: String): Any? {
        var cur: Any? = root
        for (seg in path.split('.')) {
            cur = when (cur) {
                is Map<*, *> -> cur[seg]
                is JsonNode -> cur.get(seg)?.takeUnless { it.isNull }
                else -> return null
            } ?: return null
        }
        return cur
    }

    fun stringify(v: Any?): String = when (v) {
        null -> ""
        is String -> v
        is JsonNode -> if (v.isTextual) v.asText() else v.toString()
        is Number, is Boolean -> v.toString()
        else -> runCatching { mapper.writeValueAsString(v) }.getOrElse { v.toString() }
    }

    // ── JSON template rendering ──────────────────────────────────────────────

    /**
     * Render a JSON body template.
     *
     * ── TYPES SURVIVE, WHICH A STRING TEMPLATE CANNOT DO ────────────────────
     * A string body template makes every substituted value a string: `{"qty":
     * "{{quantity}}"}` sends `"3"`, and an API that validates its own schema
     * rejects it. So a value standing ALONE in a JSON string position — the whole
     * node is exactly one placeholder — is replaced by the BOUND VALUE with its
     * own type: a number stays a number, an object stays an object, an array
     * stays an array. A placeholder embedded in surrounding text
     * (`"Bearer {{x}} suffix"`) is an interpolation and stays a string, because
     * that is unambiguously what was meant.
     *
     * This is the difference between a body template that works against a
     * strictly-typed API and one that has to be hand-edited per field.
     */
    fun renderJson(template: JsonNode, bindings: Map<String, Any?>, strict: Boolean): JsonNode =
        when {
            template.isObject -> {
                val out = mapper.createObjectNode()
                template.fields().forEach { (k, v) ->
                    val key = render(k, bindings, strict = strict)
                    val rendered = renderJson(v, bindings, strict)
                    /*
                     * An OPTIONAL placeholder that resolved to nothing removes the
                     * field rather than sending null. Many APIs treat an explicit
                     * null as "clear this value", so sending one for an argument
                     * the model simply did not supply is a destructive difference
                     * from sending nothing.
                     */
                    if (!(rendered.isNull && isSolePlaceholder(v))) out.set<JsonNode>(key, rendered)
                }
                out
            }

            template.isArray -> {
                val out = mapper.createArrayNode()
                (template as ArrayNode).forEach { out.add(renderJson(it, bindings, strict)) }
                out
            }

            template.isTextual -> {
                val raw = template.asText()
                val sole = solePlaceholderName(raw)
                if (sole != null) valueNode(resolveOptional(sole, bindings, strict))
                else mapper.getNodeFactory().textNode(render(raw, bindings, strict = strict))
            }

            else -> template
        }

    private fun isSolePlaceholder(n: JsonNode): Boolean =
        n.isTextual && solePlaceholderName(n.asText()) != null

    /** The name when [raw] is exactly one placeholder and nothing else. */
    private fun solePlaceholderName(raw: String): String? {
        val m = DOUBLE.matchEntire(raw.trim()) ?: return null
        return m.groupValues[1]
    }

    private fun resolveOptional(name: String, bindings: Map<String, Any?>, strict: Boolean): Any? {
        if (bindings.containsKey(name)) return bindings[name]
        if (name.contains('.')) {
            val v = walk(bindings[name.substringBefore('.')], name.substringAfter('.'))
            if (v != null) return v
        }
        if (strict) throw MissingBinding(name)
        return null
    }

    fun valueNode(v: Any?): JsonNode {
        val f = mapper.getNodeFactory()
        return when (v) {
            null -> f.nullNode()
            is JsonNode -> v
            is String -> f.textNode(v)
            is Int -> f.numberNode(v)
            is Long -> f.numberNode(v)
            is Double -> f.numberNode(v)
            is Float -> f.numberNode(v)
            is java.math.BigDecimal -> f.numberNode(v)
            is Boolean -> f.booleanNode(v)
            is Map<*, *> -> {
                val o: ObjectNode = f.objectNode()
                v.forEach { (k, value) -> o.set<JsonNode>(k.toString(), valueNode(value)) }
                o
            }

            is Iterable<*> -> {
                val a = f.arrayNode()
                v.forEach { a.add(valueNode(it)) }
                a
            }

            else -> f.textNode(v.toString())
        }
    }
}
