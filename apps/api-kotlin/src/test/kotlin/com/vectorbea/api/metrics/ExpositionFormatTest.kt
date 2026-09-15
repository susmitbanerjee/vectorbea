package com.vectorbea.api.metrics

import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * The API's /metrics page, checked the way a Prometheus scraper reads it. Two
 * registries render into it (see MetricsRoutes); one structural error and the
 * scraper drops the whole page, which reads in Grafana as an API with no traffic.
 */
class ExpositionFormatTest {
    @Test
    fun `the API's metrics page parses as Prometheus text`() {
        AppMetrics.requestCount.inc("GET", "2xx", "/api/runs/:id")
        val page = MetricsRegistry.scrape() + com.vectorbea.observability.metrics.MetricsRegistry.scrape()
        val problems = ExpositionCheck.problems(page)
        assertTrue(problems.isEmpty(), problems.take(20).joinToString("\n"))
    }
}

/** A small, strict reader of the text exposition format. */
object ExpositionCheck {
    private val NAME = Regex("[a-zA-Z_:][a-zA-Z0-9_:]*")
    private val SAMPLE = Regex("""^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)(\s+-?\d+)?$""")
    private val LABEL = Regex("""([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"""")

    fun problems(page: String): List<String> {
        val out = mutableListOf<String>()
        val types = HashMap<String, String>()
        val seenSeries = HashSet<String>()
        val sampledFamilies = HashSet<String>()

        page.lines().forEachIndexed { i, raw ->
            val line = raw.trimEnd()
            val at = "line ${i + 1}"
            when {
                line.isEmpty() -> Unit
                line.startsWith("# TYPE ") -> {
                    val parts = line.removePrefix("# TYPE ").split(" ")
                    val name = parts.getOrNull(0) ?: ""
                    if (!NAME.matches(name)) out += "$at: bad family name in TYPE: $line"
                    if (types.containsKey(name)) out += "$at: family $name declared twice"
                    if (name in sampledFamilies) out += "$at: TYPE for $name after its samples"
                    types[name] = parts.getOrNull(1) ?: ""
                }
                line.startsWith("#") -> Unit
                else -> {
                    val m = SAMPLE.matchEntire(line)
                    if (m == null) { out += "$at: unparseable sample: $line"; return@forEachIndexed }
                    val name = m.groupValues[1]
                    val labels = m.groupValues[3]
                    val value = m.groupValues[4]
                    if (value.toDoubleOrNull() == null && value !in setOf("NaN", "+Inf", "-Inf")) {
                        out += "$at: bad value '$value'"
                    }
                    if (labels.isNotEmpty()) {
                        val rebuilt = LABEL.findAll(labels).joinToString(",") { it.value }
                        if (rebuilt != labels.trimEnd(',')) out += "$at: bad label syntax: {$labels}"
                    }
                    val family = familyOf(name, types)
                    if (family == null) out += "$at: sample $name has no TYPE"
                    else sampledFamilies += family
                    val key = "$name{${LABEL.findAll(labels).map { it.value }.sorted().joinToString(",")}}"
                    if (!seenSeries.add(key)) out += "$at: duplicate series $key"
                }
            }
        }
        return out
    }

    private fun familyOf(sample: String, types: Map<String, String>): String? {
        if (types.containsKey(sample)) return sample
        for (suffix in listOf("_bucket", "_sum", "_count", "_total", "_created")) {
            if (sample.endsWith(suffix)) {
                val base = sample.removeSuffix(suffix)
                if (types.containsKey(base)) return base
            }
        }
        return null
    }
}
