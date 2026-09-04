package com.vectorbea.worker.runtime.graph

import com.vectorbea.graph.WorkflowGraph

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Graph parsing across the THREE dialects that are in the database.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * `convertNode` used to decide the dialect from `data.isNotEmpty()` and then read
 * config ONLY from the type-specific `data.<type>Config` key.
 *
 * `src/lib/workflows/graph-codec.ts` — what the current builder saves — writes the
 * SUPERSET on purpose: flat `type`/`label`/`config` for this parser, plus
 * `position`/`data` for the canvas. Its `data` carries `data.config`, not
 * `data.agentConfig`. So the flag said "React Flow", the lookup missed, and every
 * node saved by that builder reached its executor with an EMPTY config:
 *
 *     Agent node 'n-new-agent-2' missing required config: agentId
 *
 * Agent nodes failed loudest only because `agentId` is validated first — the same
 * graph stripped `toolId` off tool nodes and `connectionId` off llm nodes just as
 * silently, which would have surfaced later as much stranger failures.
 *
 * A dialect is therefore never chosen; the sources are merged.
 */
class WorkflowGraphTest {

    // ── graph-codec dialect (the current builder) ─────────────────────────────

    @Test
    fun `reads agentId from the flat config the current builder writes`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"n-new-agent-2",
              "type":"agent",
              "label":"City picker",
              "config":{"agentId":"a1b2","taskInstruction":"Pick 5 cities"},
              "position":{"x":260,"y":0},
              "data":{"label":"City picker","nodeType":"agent",
                      "config":{"agentId":"a1b2","taskInstruction":"Pick 5 cities"}}
            }],"edges":[]}
            """.trimIndent()
        )

        val node = graph.nodeById("n-new-agent-2")!!
        assertEquals("a1b2", node.config["agentId"])
        assertEquals("Pick 5 cities", node.config["taskInstruction"])
        assertEquals("City picker", node.label)
    }

    @Test
    fun `reads toolId for a tool node in the same dialect`() {
        // Not agent-specific: the empty config hit every node type.
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"n-new-tool-3","type":"tool","label":"Save picks",
              "config":{"toolId":"t9"},
              "position":{"x":0,"y":0},
              "data":{"label":"Save picks","nodeType":"tool","config":{"toolId":"t9"}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("t9", graph.nodeById("n-new-tool-3")!!.config["toolId"])
    }

    @Test
    fun `reads connectionId for an llm node in the same dialect`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"n-new-llm-4","type":"llm","label":"Summarise",
              "config":{"connectionId":"c7","model":"gpt-4o-mini",
                        "systemPrompt":"You summarise.","userPromptTemplate":"{{input}}"},
              "position":{"x":0,"y":0},
              "data":{"label":"Summarise","nodeType":"llm",
                      "config":{"connectionId":"c7","model":"gpt-4o-mini",
                                "systemPrompt":"You summarise.","userPromptTemplate":"{{input}}"}}
            }],"edges":[]}
            """.trimIndent()
        )

        val node = graph.nodeById("n-new-llm-4")!!
        assertEquals("c7", node.config["connectionId"])

        @Suppress("UNCHECKED_CAST")
        val messages = node.config["messages"] as List<Map<String, Any>>
        assertEquals(2, messages.size)
        assertEquals("system", messages[0]["role"])
        assertEquals("user", messages[1]["role"])
    }

    // ── Legacy React Flow dialect ─────────────────────────────────────────────

    @Test
    fun `still reads the legacy per-type config block`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"agent-1","type":"agent",
              "position":{"x":0,"y":0},
              "data":{"label":"Legacy agent","agentConfig":{"agentId":"legacy-a"}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("legacy-a", graph.nodeById("agent-1")!!.config["agentId"])
    }

    @Test
    fun `the type-specific block wins over a generic one`() {
        // Only a graph written by two builders has both. The block the type-specific
        // inspector wrote is the more deliberate statement, so it wins.
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"agent-1","type":"agent",
              "config":{"agentId":"from-flat"},
              "data":{"label":"A","config":{"agentId":"from-data-config"},
                      "agentConfig":{"agentId":"from-agent-config"}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("from-agent-config", graph.nodeById("agent-1")!!.config["agentId"])
    }

    @Test
    fun `still remaps sqlTemplate for a legacy db_write node`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"w1","type":"db_write",
              "data":{"label":"Insert","dbWriteConfig":{"sqlTemplate":"INSERT INTO t VALUES (1)"}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("INSERT INTO t VALUES (1)", graph.nodeById("w1")!!.config["statement"])
    }

    @Test
    fun `remaps sqlTemplate in the current builder dialect too`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"n-new-db_write-5","type":"db_write","label":"Insert",
              "config":{"sqlTemplate":"INSERT INTO t VALUES (1)","connectionId":"c1"},
              "data":{"label":"Insert","nodeType":"db_write",
                      "config":{"sqlTemplate":"INSERT INTO t VALUES (1)","connectionId":"c1"}}
            }],"edges":[]}
            """.trimIndent()
        )

        val node = graph.nodeById("n-new-db_write-5")!!
        assertEquals("INSERT INTO t VALUES (1)", node.config["statement"])
        assertEquals("c1", node.config["connectionId"])
    }

    // ── Architect dialect ─────────────────────────────────────────────────────
    //
    // `WorkflowArchitectService.compilePlanToGraphJson` writes `agentId` / `toolId`
    // directly onto `data`, with no wrapping block. Same empty-config failure, and
    // it would have survived the builder fix on its own.

    @Test
    fun `reads agentId written directly on data by the Architect`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"s2","type":"agent","position":{"x":0,"y":0},
              "data":{"label":"Pick cities","nodeType":"agent","agentId":"arch-a1",
                      "status":"ready","generatedByArchitect":true}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("arch-a1", graph.nodeById("s2")!!.config["agentId"])
    }

    @Test
    fun `reads toolId written directly on data by the Architect`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"s3","type":"tool",
              "data":{"label":"Save","nodeType":"tool","toolId":"arch-t1","status":"ready"}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("arch-t1", graph.nodeById("s3")!!.config["toolId"])
    }

    @Test
    fun `does not fold canvas metadata into config`() {
        // `label` and `nodeType` are read elsewhere; letting them through would put
        // canvas noise where executors look for values.
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"s2","type":"agent",
              "data":{"label":"Pick cities","nodeType":"agent","description":"d",
                      "status":"ready","agentId":"arch-a1"}
            }],"edges":[]}
            """.trimIndent()
        )

        val config = graph.nodeById("s2")!!.config
        assertEquals("arch-a1", config["agentId"])
        assertTrue("label" !in config, "label must not leak into config")
        assertTrue("nodeType" !in config, "nodeType must not leak into config")
        assertTrue("status" !in config, "status must not leak into config")
    }

    @Test
    fun `a deliberate config block outranks a data leaf`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"s2","type":"agent",
              "config":{"agentId":"from-flat"},
              "data":{"label":"A","nodeType":"agent","agentId":"from-data-leaf"}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals("from-flat", graph.nodeById("s2")!!.config["agentId"])
    }

    @Test
    fun `reads the Architect plural mapping spelling`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"s3","type":"tool",
              "data":{"label":"Save","nodeType":"tool","toolId":"t1",
                      "inputMappings":{"cities":"steps.s2.output.cities"}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals(
            mapOf("cities" to "steps.s2.output.cities"),
            graph.nodeById("s3")!!.inputMapping,
        )
    }

    // ── Internal dialect ──────────────────────────────────────────────────────

    @Test
    fun `reads the internal flat dialect with no data block`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"agent-1","type":"agent","label":"Flat",
              "config":{"agentId":"flat-a"}
            }],"edges":[]}
            """.trimIndent()
        )

        val node = graph.nodeById("agent-1")!!
        assertEquals("flat-a", node.config["agentId"])
        assertEquals("Flat", node.label)
    }

    @Test
    fun `keeps an explicit messages list rather than replacing it with an empty one`() {
        // The internal dialect supplies `messages` directly and carries no prompts.
        // Building an empty list from the absent prompts and overwriting would leave
        // the executor with nothing to send.
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"llm-1","type":"llm","label":"Direct",
              "config":{"connectionId":"c1",
                        "messages":[{"role":"user","content":"hello"}]}
            }],"edges":[]}
            """.trimIndent()
        )

        @Suppress("UNCHECKED_CAST")
        val messages = graph.nodeById("llm-1")!!.config["messages"] as List<Map<String, Any>>
        assertEquals(1, messages.size)
        assertEquals("hello", messages[0]["content"])
    }

    // ── Mappings ──────────────────────────────────────────────────────────────

    @Test
    fun `reads an input mapping from the node config`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"n-new-tool-1","type":"tool","label":"T",
              "config":{"toolId":"t1","inputMapping":{"cities":"steps.agent.output.cities"}},
              "data":{"label":"T","nodeType":"tool",
                      "config":{"toolId":"t1","inputMapping":{"cities":"steps.agent.output.cities"}}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals(
            mapOf("cities" to "steps.agent.output.cities"),
            graph.nodeById("n-new-tool-1")!!.inputMapping,
        )
    }

    @Test
    fun `still reads the legacy inputMappingJson block`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"t1","type":"tool",
              "data":{"label":"T","toolConfig":{"toolId":"t1"},
                      "inputMappingJson":{"a":"workflow.input.a"}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals(mapOf("a" to "workflow.input.a"), graph.nodeById("t1")!!.inputMapping)
    }

    @Test
    fun `still reads a legacy toolConfig inputMapping`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[{
              "id":"t1","type":"tool",
              "data":{"label":"T","toolConfig":{"toolId":"t1","inputMapping":{"a":"workflow.input.a"}}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals(mapOf("a" to "workflow.input.a"), graph.nodeById("t1")!!.inputMapping)
    }

    // ── Edges ─────────────────────────────────────────────────────────────────

    @Test
    fun `parses edges from both dialects`() {
        val graph = WorkflowGraph.parse(
            """
            {"nodes":[
              {"id":"a","type":"trigger","label":"A","config":{}},
              {"id":"b","type":"agent","label":"B","config":{"agentId":"x"}}
            ],"edges":[
              {"id":"e1","source":"a","target":"b","type":"default","data":{"edgeType":"standard"}}
            ]}
            """.trimIndent()
        )

        assertEquals(1, graph.edgesFrom("a").size)
        assertEquals("b", graph.edgesFrom("a").first().target)
        assertTrue(graph.inboundSources("b").contains("a"))
    }
}
