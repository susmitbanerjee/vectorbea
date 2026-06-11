package com.vectorbea.worker.mapping

/**
 * Lightweight JSON-path-like resolver for nested map/list structures.
 *
 * Supports a restricted subset of JSONPath notation:
 *
 *   $.body.data.customers       → root → body → data → customers
 *   $.rows[0]                   → root → rows (List) → element 0
 *   $.rows[*]                   → root → rows (List) → all elements (returns the List)
 *   $.nested.arr[2].id          → root → nested → arr[2] → id
 *   body.data.customers         → (no $ prefix) same as above
 *   customerId                  → single key at root
 *
 * All navigation is read-only.  No mutations, no predicates, no wildcards
 * beyond [*].  This keeps the implementation safe and auditable.
 *
 * SECURITY: Path strings come from workflow builder config and are treated
 * as untrusted data — they are pattern-matched only, never eval'd.
 */
object JsonPathResolver {

    /**
     * Resolve [path] against [root] (a nested Map/List structure).
     * Returns null if any segment along the path is missing or type-incompatible.
     */
    fun resolve(path: String, root: Any?): Any? {
        if (root == null) return null
        val normalised = normalisePath(path)
        if (normalised.isEmpty()) return root
        return navigate(normalised, root)
    }

    /**
     * Convenience: resolve [path] into a [Map<String, Any>] root.
     */
    fun resolvePathInMap(path: String, root: Map<String, Any>): Any? = resolve(path, root)

    /**
     * Resolve [path] against [root] and coerce to Map<String, Any>.
     * Returns null if the result is not a map.
     */
    @Suppress("UNCHECKED_CAST")
    fun resolveAsMap(path: String, root: Any?): Map<String, Any>? =
        resolve(path, root) as? Map<String, Any>

    /**
     * Resolve [path] against [root] and coerce to List<Any>.
     * Returns null if the result is not a list.
     */
    @Suppress("UNCHECKED_CAST")
    fun resolveAsList(path: String, root: Any?): List<Any>? =
        resolve(path, root) as? List<Any>

    // ── Internal ──────────────────────────────────────────────────────────────

    /** Normalise the path string: strip leading `$`, split by `.`, parse array indices. */
    private fun normalisePath(path: String): List<Segment> {
        val stripped = path.trimStart().removePrefix("$").trimStart('.')
        if (stripped.isBlank()) return emptyList()

        val segments = mutableListOf<Segment>()
        for (part in stripped.split(".")) {
            // Handle array notation within each part: "rows[0]", "items[*]"
            val bracket = part.indexOf('[')
            if (bracket >= 0) {
                val key   = part.substring(0, bracket)
                val index = part.substring(bracket + 1, part.lastIndexOf(']'))
                if (key.isNotEmpty()) segments.add(Segment.Key(key))
                segments.add(if (index == "*") Segment.Wildcard else Segment.Index(index.toIntOrNull() ?: 0))
            } else {
                segments.add(Segment.Key(part))
            }
        }
        return segments
    }

    @Suppress("UNCHECKED_CAST")
    private fun navigate(segments: List<Segment>, current: Any?): Any? {
        if (segments.isEmpty()) return current
        val head = segments.first()
        val tail = segments.drop(1)

        return when (head) {
            is Segment.Key -> {
                val map = current as? Map<*, *> ?: return null
                navigate(tail, map[head.name])
            }
            is Segment.Index -> {
                val list = current as? List<*> ?: return null
                val idx  = head.index
                if (idx < 0 || idx >= list.size) return null
                navigate(tail, list[idx])
            }
            is Segment.Wildcard -> {
                // Return the whole list (filtered navigation would need predicates)
                current as? List<*>
            }
        }
    }

    private sealed class Segment {
        data class Key(val name: String)  : Segment()
        data class Index(val index: Int)  : Segment()
        object Wildcard                   : Segment()
    }
}
