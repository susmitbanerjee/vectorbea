package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertContains
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

class AgentHttpTemplateTest {
    private val spec = assertNotNull(HttpToolSpec.parse("""{
      "specVersion":1,
      "request":{"method":"POST","baseUrl":"https://example.com","path":"/customers/{{id}}",
        "inputs":[
          {"name":"id","in":"path","wireName":"id","required":true,"type":"string"},
          {"name":"query","in":"query","wireName":"q","required":true,"type":"string"},
          {"name":"source","in":"body","required":true,"type":"string"},
          {"name":"count","in":"body","required":true,"type":"integer"},
          {"name":"enabled","in":"body","required":true,"type":"boolean"},
          {"name":"fixed_0","in":"query","wireName":"accent-insensitive","constant":"false"}
        ],
        "body":{"encoding":"json","template":{"source":"{{source}}","count":"{{count}}","enabled":"{{enabled}}"}}
      },"auth":{"strategy":"api_key_header","header":"apy_token","secretField":"value"}
    }"""))

    @Test fun `agent arguments resolve with the same types and encodings as test values`() {
        val request = RequestAssembler.assemble(spec, null, mapOf(
            "id" to "a/b?c", "query" to "hello & world", "source" to "ing", "count" to 3, "enabled" to false,
            "fixed_0" to "true"
        ))
        assertContains(request.url, "/customers/a%2Fb%3Fc?")
        assertContains(request.url, "q=hello+%26+world")
        assertContains(request.url, "accent-insensitive=false")
        val body = ObjectMapper().readTree(request.body)
        assertEquals("ing", body.path("source").asText())
        assertEquals(3, body.path("count").intValue())
        assertEquals(false, body.path("enabled").booleanValue())
    }

    @Test fun `missing agent arguments fail before the request is sent`() {
        assertFailsWith<RequestAssembler.AssemblyException> { RequestAssembler.assemble(spec, null, emptyMap()) }
    }
}
