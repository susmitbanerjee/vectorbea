package com.vectorbea.worker.agents.skills

import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.delivery.DeliveryDispatcher
import com.vectorbea.worker.delivery.DeliveryStore
import com.vectorbea.worker.runtime.executor.AgentNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.testsupport.RecordingEventStore
import com.vectorbea.worker.testsupport.ScriptedLlmProvider
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The worked scenario, end to end: research → script → video → deliver.
 *
 * ── WHY THIS TEST EXISTS RATHER THAN FOUR SMALLER ONES ──────────────────────
 * Every mechanism it touches already has a test of its own — `DelegationTest`
 * for the roster, `McpToolPathTest` for the MCP arm, `SkillCompositionTest` for
 * the budget, `DeliveryAcceptanceTest` for the retry. Each of those passes while
 * proving very little about the product, because what can actually be wrong here
 * is the WIRING: whether a delegated CHILD composes its OWN skills rather than
 * its parent's, whether the loader survives being handed down through
 * `runChildAgent`, whether the composition is recorded against the child's
 * activation rather than the run, whether the answer a skill shaped is the
 * answer that gets delivered. All of that lives between the classes.
 *
 * So this drives one run, through the real `AgentNodeExecutor`, against a real
 * Postgres, with a real socket for the MCP server and for the delivery receiver.
 * Only the model is scripted.
 *
 * ── WHAT IT COVERS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 * Covered: skills (granted per agent, composed per activation, recorded),
 * delegation (three children under one supervisor), MCP (a real JSON-RPC call
 * over a socket, inside a delegated child), and delivery (a real receiver, with
 * the pipeline's output in the body).
 *
 * NOT covered here: the ASYNC-tool leg. An async tool ends the tick and parks
 * the run on a `run_waits` row, so a pipeline that included one would become a
 * test of suspend-and-resume with a pipeline attached — a different subject,
 * with a different failure mode, already covered by `AsyncToolProtocolTest`.
 * Combining them would make both harder to read and neither stronger.
 */
@Tag("integration")
class SkillPipelineAcceptanceTest {

    private val mapper = ObjectMapper()
    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres

    private lateinit var w: World
    private lateinit var server: HttpServer
    private lateinit var baseUrl: String

    /** Everything the delivery receiver got. */
    private val delivered = ConcurrentLinkedQueue<String>()

    /** Every MCP request body the "server" received. */
    private val mcpCalls = ConcurrentLinkedQueue<String>()

    /** Which decision the supervisor is on. Reset per test by [start]. */
    private val producerTurn = java.util.concurrent.atomic.AtomicInteger(0)

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
        val llmConnectionId: UUID = UUID.randomUUID(),
        val mcpConnectionId: UUID = UUID.randomUUID(),
    ) {
        lateinit var videoTool: UUID
        lateinit var searchTool: UUID
        val agents = mutableMapOf<String, UUID>()
        val skills = mutableMapOf<String, UUID>()
        operator fun get(name: String): UUID = agents.getValue(name)
    }

    @BeforeEach
    fun start() {
        delivered.clear(); mcpCalls.clear(); producerTurn.set(0)
        server = HttpServer.create(InetSocketAddress(TEST_HOST, 0), 0)
        /* One socket, two roles. The MCP server and the delivery receiver are
           different endpoints on it, which is also how a customer's estate looks. */
        server.createContext("/rpc") { ex -> handleMcp(ex) }
        server.createContext("/deliver") { ex -> handleDelivery(ex) }
        server.executor = java.util.concurrent.Executors.newFixedThreadPool(4)
        server.start()
        baseUrl = "http://$TEST_HOST:${server.address.port}"
        w = seed()
    }

    @AfterEach
    fun stop() {
        server.stop(0)
        cleanup()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // THE ACCEPTANCE CRITERION
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `the research, script, video and deliver pipeline runs end to end`() {
        val llm = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        val events = RecordingEventStore()

        val result = runBlocking {
            executor(llm, events).execute(producerNode(), emptyMap(), ctx())
        }

        assertTrue(result is NodeResult.Completed,
            "the pipeline did not finish: ${(result as? NodeResult.Failed)?.reason}")

        // ── 1. Every stage ran, in order, as its own activation ──────────────
        val activations = activationRows()
        assertEquals(
            listOf("producer", "researcher", "scriptwriter", "videographer"),
            activations.map { it.second },
            "one activation per stage, in pipeline order",
        )

        // ── 2. The MCP video tool was actually called, over a real socket ────
        assertEquals(1, mcpCalls.size, "the video agent called the generation tool exactly once")
        assertTrue(mcpCalls.first().contains("tools/call"))
        assertTrue(mcpCalls.first().contains("generate_video"))

        // ── 3. The answer carries what the pipeline produced ─────────────────
        val output = mapper.writeValueAsString((result as NodeResult.Completed).output)
        assertTrue(output.contains("asset://shot-1"),
            "the video agent's asset references reached the supervisor's answer: $output")

        // ── 4. Delivery — a second axis, after the answer was right ──────────
        markRunSucceeded(output)
        addDeliveryTarget()
        val store = DeliveryStore(ds)
        store.enqueueForRun(w.runId, "succeeded")
        DeliveryDispatcher(dataSource = ds, store = store, secrets = null).tick()

        assertEquals(1, delivered.size, "the receiver was called exactly once")
        assertTrue(delivered.first().contains("asset://shot-1"),
            "what was delivered is what the pipeline produced: ${delivered.first()}")
        assertEquals("delivered", runDeliveryStatus())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: each agent got ITS OWN skill, and only its own
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `each delegated child composes its own skills, not its parent's`() {
        /*
         * The wiring claim. A child is run by a runner built inside
         * `runChildAgent`, with the child's grants and the child's activation —
         * so a loader that was rebuilt there rather than handed down would read
         * the process environment, silently compose nothing, and every assertion
         * about behaviour would still pass because a skill only changes quality.
         */
        val llm = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        runBlocking { executor(llm, RecordingEventStore()).execute(producerNode(), emptyMap(), ctx()) }

        val prompts = llm.requests().mapNotNull { it.systemPrompt }

        val research = prompts.first { it.contains("You are researcher") }
        assertTrue(research.contains("SKILL: Research brief"))
        assertTrue(research.contains("Search before you assert"),
            "the platform skill's actual text, not just its title")
        assertFalse(research.contains("SKILL: Video production"),
            "a skill granted to another agent must not leak into this one")

        val script = prompts.first { it.contains("You are scriptwriter") }
        assertTrue(script.contains("SKILL: Short-form video script"))
        assertTrue(script.contains("Write the first three seconds first"))

        val video = prompts.first { it.contains("You are videographer") }
        assertTrue(video.contains("SKILL: Video production"))
        assertTrue(video.contains("Generate SHOT ONE ALONE and stop"))

        val producer = prompts.first { it.contains("You are producer") }
        assertFalse(producer.contains("YOUR SKILLS"),
            "the supervisor holds no skills, so it is shown no skills block")
    }

    @Test
    fun `a skill composes after the agent's own instructions and before the task`() {
        /* The position is the precedence claim: the agent's instructions are who
           it is, a skill is how it does one kind of work. */
        val llm = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        runBlocking { executor(llm, RecordingEventStore()).execute(producerNode(), emptyMap(), ctx()) }

        val video = llm.requests().mapNotNull { it.systemPrompt }.first { it.contains("You are videographer") }
        val instructions = video.indexOf("INSTRUCTIONS:")
        val skills = video.indexOf("YOUR SKILLS")
        val task = video.indexOf("YOUR TASK will be given")
        assertTrue(instructions in 0 until skills, "skills come after the agent's own instructions")
        assertTrue(skills < task, "and before anything the run produced")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: active skills are visible per activation in the Debug tab
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `which skills were active is recorded against each activation`() {
        /*
         * The Debug tab reads `agent_activation_skills`, keyed by activation, and
         * not the span tree — because invariant 7 lets a span be dropped under
         * back-pressure and a skills panel that is empty for that reason reads as
         * a product that lost your data.
         */
        val llm = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        runBlocking { executor(llm, RecordingEventStore()).execute(producerNode(), emptyMap(), ctx()) }

        val rows = activationSkillRows()
        assertEquals(
            mapOf(
                "researcher" to "research-brief",
                "scriptwriter" to "video-script",
                "videographer" to "video-production",
            ),
            rows,
            "one row per (activation, skill), attributed to the agent that ran it",
        )

        /* Every row is attached to a real activation, which is what makes the
           constellation's join land — it keys on the activation id. */
        assertEquals(0, orphanedSkillRows(), "no skills row without an activation to hang it on")
    }

    @Test
    fun `the recorded row names the version, so a behaviour change is attributable`() {
        val llm = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        runBlocking { executor(llm, RecordingEventStore()).execute(producerNode(), emptyMap(), ctx()) }

        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT slug, version, provenance, included FROM agent_activation_skills " +
                    "WHERE run_id=? AND slug='video-production'"
            ).use { st ->
                st.setObject(1, w.runId)
                st.executeQuery().use { rs ->
                    assertTrue(rs.next(), "no row for the video skill")
                    assertEquals(1, rs.getInt("version"))
                    assertEquals("first_party", rs.getString("provenance"))
                    assertTrue(rs.getBoolean("included"))
                }
            }
        }
    }

    @Test
    fun `re-running the same step does not accumulate a row per attempt`() {
        /* Invariant 2: a step re-executes from iteration 1 on resume, so the key
           carries no attempt number and the write is an upsert. */
        val llm = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        runBlocking { executor(llm, RecordingEventStore()).execute(producerNode(), emptyMap(), ctx()) }
        val first = countSkillRows()

        val llm2 = ScriptedLlmProvider().apply { respondWith(::answerFor) }
        runBlocking { executor(llm2, RecordingEventStore()).execute(producerNode(), emptyMap(), ctx()) }

        assertTrue(countSkillRows() >= first, "sanity")
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT count(*) FROM (
                     SELECT run_id, step_id, activation_id, skill_id, count(*) AS n
                       FROM agent_activation_skills WHERE run_id = ?
                      GROUP BY 1,2,3,4 HAVING count(*) > 1) dup"""
            ).use { st ->
                st.setObject(1, w.runId)
                st.executeQuery().use { rs ->
                    rs.next()
                    assertEquals(0, rs.getInt(1), "a second attempt overwrote its own row")
                }
            }
        }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // The scripted model
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Which agent is asking, and what it says next.
     *
     * Routed by the agent's own name in the system prompt rather than by call
     * order, because delegation interleaves parent and child turns and an
     * order-indexed script would break the first time the loop changed when it
     * re-prompts the supervisor.
     */
    private fun answerFor(req: ScriptedLlmProvider.RecordedRequest): String {
        val system = req.systemPrompt ?: ""
        val user = req.userPrompt ?: ""
        return when {
            system.contains("You are researcher") -> content(
                """{"type":"FINAL","finalOutput":{"question":"Do grid batteries pay back?",
                   "findings":[{"claim":"Costs fell 40% in four years","source":"https://example.test/1"}]}}"""
            )

            system.contains("You are scriptwriter") -> content(
                """{"type":"FINAL","finalOutput":{"idea":"Batteries got cheap fast",
                   "totalSeconds":8,"shots":[{"index":1,"seconds":8,"subject":"a battery yard at dusk",
                   "camera":"slow push in","lighting":"overcast","narration":"It took four years."}]}}"""
            )

            /* The video agent calls the MCP tool first, then answers with what
               came back — which is what makes the assertion on the supervisor's
               output an assertion about the whole chain. */
            system.contains("You are videographer") ->
                if (!user.contains("RESULT:")) content(
                    """{"type":"CALL_TOOL","reasoningSummary":"generate shot one alone",
                       "toolId":"${w.videoTool}","toolInput":{"prompt":"a battery yard at dusk"}}"""
                ) else content(
                    """{"type":"FINAL","finalOutput":{"shots":[{"index":1,"assetRef":"asset://shot-1","seconds":8}],
                       "totalSeconds":8,"failures":[]}}"""
                )

            /* The supervisor: delegate to each stage in turn, then answer.
               Counted rather than inferred from the transcript — a delegation is
               inline, so the supervisor's Nth turn is the Nth decision, and
               reading the observations to work out where it had got to would make
               the script depend on how the loop words them. */
            else -> content(
                when (producerTurn.getAndIncrement()) {
                    0 -> delegate("researcher", "Research the brief.")
                    1 -> delegate("scriptwriter", "Write the script.")
                    2 -> delegate("videographer", "Shoot the script.")
                    else -> """{"type":"FINAL","finalOutput":{"video":{"shots":[{"assetRef":"asset://shot-1"}]}}}"""
                }
            )
        }
    }

    private fun delegate(agent: String, objective: String) =
        """{"type":"DELEGATE","reasoningSummary":"$agent handles this",
           "targetAgentId":"${w[agent]}","contract":{"objective":"$objective"}}"""

    /**
     * One action, as the MODEL's message content.
     *
     * `respondWith` wraps whatever this returns in the provider envelope, so
     * returning an envelope here nests one inside the other: every action then
     * arrives at the parser as unreadable text, the loop reports "failed to
     * parse", and it spends its whole iteration budget retrying — which looks
     * like a broken agent rather than a broken stub.
     *
     * Newlines are collapsed because these are written as readable multi-line
     * literals and a real provider returns one line.
     */
    private fun content(action: String): String =
        action.trimIndent().replace(Regex("""\s*\n\s*"""), " ")

    // ─────────────────────────────────────────────────────────────────────────
    // The world
    // ─────────────────────────────────────────────────────────────────────────

    private fun executor(llm: ScriptedLlmProvider, events: RecordingEventStore) = AgentNodeExecutor(
        dataSource = ds,
        connectionResolver = resolver(),
        eventStore = events,
        dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager(),
        activationsEnabled = true,
        llmHttpClient = llm,
        delegationEnabled = true,
        skillsEnabled = true,
    )

    /**
     * One resolver, two connections.
     *
     * The LLM connection is a stub because the provider is scripted at the HTTP
     * seam; the MCP connection is real and points at this test's own socket, so
     * the JSON-RPC call is genuinely made.
     */
    private fun resolver() = object : ConnectionResolver(
        com.vectorbea.worker.testsupport.noOpDataSource(),
        com.vectorbea.worker.testsupport.noOpSecretService(),
    ) {
        override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?):
            ResolvedConnection = ResolvedConnection(
            record = if (connectionId == w.mcpConnectionId) ConnectionRecord(
                id = w.mcpConnectionId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                name = "video mcp", type = "tool", provider = "mcp", status = "active",
                authType = "none", secretRef = null,
                configJson = mapOf("serverUrl" to "$baseUrl/rpc"),
                /* The test's own loopback host, named explicitly. Invariant 20:
                   reaching a private address is per connection, off by default,
                   and useless without an allow-list. */
                allowedHosts = listOf(TEST_HOST),
                egressPolicy = com.vectorbea.worker.connector.SsrfGuard.EgressPolicy.PRIVATE_ALLOWED,
                allowedPaths = emptyList(), allowedSchemas = emptyList(), allowedTables = emptyList(),
            ) else ConnectionRecord(
                id = connectionId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                name = "llm", type = "llm", provider = "openai", status = "active",
                authType = "api_key", secretRef = null,
                /* Stored WITHOUT /v1 — every caller appends the rest itself. */
                configJson = mapOf("baseUrl" to "https://provider.invalid"),
                allowedHosts = emptyList(), allowedPaths = emptyList(),
                allowedSchemas = emptyList(), allowedTables = emptyList(),
            ),
            /*
             * A FRESH SecretValue per resolve, and null only for MCP.
             *
             * `useOnce` zeroes the backing array, so a shared instance fails on the
             * second resolve with "already cleared" — correct hygiene in production,
             * and the reason a multi-iteration loop cannot reuse a stub secret.
             */
            secret = if (connectionId == w.mcpConnectionId) null
                     else com.vectorbea.worker.connector.SecretValue("test-key".toCharArray()),
        )
    }

    private fun producerNode() = WorkflowNode(
        id = STEP_ID, type = "agent",
        config = mapOf(
            "agentId" to w["producer"].toString(),
            "taskInstruction" to "Make a short video about grid batteries.",
        ),
    )

    private fun ctx() = RuntimeContext(
        runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
        workflowVersionId = w.versionId, workflowId = w.workflowId,
        workflowInput = emptyMap(), graph = WorkflowGraph(),
    )

    // ── HTTP handlers ────────────────────────────────────────────────────────

    private fun handleMcp(ex: HttpExchange) {
        val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
        mcpCalls += body
        val reply = """{"jsonrpc":"2.0","id":"1","result":{"content":[{"type":"text",""" +
            """"text":"{\"assetRef\":\"asset://shot-1\",\"seconds\":8}"}]}}"""
        respond(ex, 200, reply)
    }

    private fun handleDelivery(ex: HttpExchange) {
        delivered += ex.requestBody.readBytes().toString(Charsets.UTF_8)
        respond(ex, 200, """{"ok":true}""")
    }

    private fun respond(ex: HttpExchange, status: Int, payload: String) {
        val bytes = payload.toByteArray()
        ex.responseHeaders.add("Content-Type", "application/json")
        ex.sendResponseHeaders(status, bytes.size.toLong())
        ex.responseBody.use { it.write(bytes) }
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /** (activation id, agent name), in execution order. */
    private fun activationRows(): List<Pair<UUID, String>> = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT a.id, ag.name FROM agent_activations a
                 JOIN agents ag ON ag.id = a.agent_id
                WHERE a.run_id = ? ORDER BY a.sequence"""
        ).use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs ->
                buildList { while (rs.next()) add(rs.getObject("id", UUID::class.java) to rs.getString("name")) }
            }
        }
    }

    /** agent name -> the skill slug composed into its activation. */
    private fun activationSkillRows(): Map<String, String> = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT ag.name, s.slug FROM agent_activation_skills s
                 JOIN agents ag ON ag.id = s.agent_id
                WHERE s.run_id = ? AND s.included ORDER BY ag.name"""
        ).use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs ->
                buildMap { while (rs.next()) put(rs.getString("name"), rs.getString("slug")) }
            }
        }
    }

    private fun orphanedSkillRows(): Int = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT count(*) FROM agent_activation_skills s
                LEFT JOIN agent_activations a ON a.id = s.activation_id
                WHERE s.run_id = ? AND a.id IS NULL"""
        ).use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    private fun countSkillRows(): Int = ds.connection.use { c ->
        c.prepareStatement("SELECT count(*) FROM agent_activation_skills WHERE run_id=?").use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    private fun runDeliveryStatus(): String? = ds.connection.use { c ->
        c.prepareStatement("SELECT delivery_status FROM agent_runs WHERE id = ?").use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
        }
    }

    // ── Writes ───────────────────────────────────────────────────────────────

    private fun markRunSucceeded(output: String) = ds.connection.use { c ->
        c.prepareStatement(
            "UPDATE agent_runs SET status='succeeded', output_json=?::jsonb, completed_at=now() WHERE id=?"
        ).use { st -> st.setString(1, output); st.setObject(2, w.runId); st.executeUpdate() }
    }

    private fun addDeliveryTarget() = ds.connection.use { c ->
        c.prepareStatement(
            """INSERT INTO delivery_targets
                 (workspace_id, environment_id, workflow_id, name, kind, callback_url,
                  on_statuses, max_attempts, timeout_ms, payload_mode, max_payload_bytes)
               VALUES (?,?,?,'Publisher','callback',?,?,3,5000,'auto',262144)"""
        ).use { st ->
            st.setObject(1, w.workspaceId); st.setObject(2, w.environmentId)
            st.setObject(3, w.workflowId); st.setString(4, "$baseUrl/deliver")
            st.setArray(5, c.createArrayOf("text", arrayOf("succeeded")))
            st.executeUpdate()
        }
    }

    private fun seed(): World {
        val world = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, world.workspaceId); it.setString(2, "skill-pipeline")
                it.setString(3, "skill-pipeline-" + world.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, world.environmentId); it.setObject(2, world.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, world.workflowId); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setString(4, "wf-" + world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, world.versionId); it.setObject(2, world.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status) VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, world.runId); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setObject(4, world.workflowId)
                it.setObject(5, world.versionId); it.executeUpdate()
            }

            world.videoTool = mcpTool(c, world, "generate_video")
            world.searchTool = httpTool(c, world, "web_search")

            agent(c, world, "producer")
            agent(c, world, "researcher", tools = listOf(world.searchTool))
            agent(c, world, "scriptwriter")
            agent(c, world, "videographer", tools = listOf(world.videoTool))
            roster(c, world, "producer", "researcher", "scriptwriter", "videographer")

            /*
             * Installed from the REAL catalogue, binding each declared capability
             * to one of this workspace's tools — the same two steps the install
             * endpoint performs, and the same text a customer would get. Seeding
             * invented skill text here would test the pipeline against prose
             * nobody ships.
             */
            world.skills["research-brief"] =
                installFromCatalogue(c, world, "research-brief", mapOf("web.search" to world.searchTool))
            world.skills["video-script"] =
                installFromCatalogue(c, world, "video-script", emptyMap())
            world.skills["video-production"] =
                installFromCatalogue(c, world, "video-production", mapOf("video.generate" to world.videoTool))

            grantSkill(c, world, "researcher", "research-brief")
            grantSkill(c, world, "scriptwriter", "video-script")
            grantSkill(c, world, "videographer", "video-production")
        }
        return world
    }

    private fun mcpTool(c: java.sql.Connection, world: World, name: String): UUID {
        val id = UUID.randomUUID()
        c.prepareStatement(
            """INSERT INTO tools (id, workspace_id, environment_id, name, slug, type, description,
                 config_json, requires_approval, status, mcp_server_connection_id, mcp_tool_name)
               VALUES (?,?,?,?,?,'mcp','Generates one video shot.','{}'::jsonb,false,'active',?,?)"""
        ).use {
            it.setObject(1, id); it.setObject(2, world.workspaceId); it.setObject(3, world.environmentId)
            it.setString(4, name); it.setString(5, "$name-$id")
            it.setObject(6, world.mcpConnectionId); it.setString(7, name)
            it.executeUpdate()
        }
        return id
    }

    private fun httpTool(c: java.sql.Connection, world: World, name: String): UUID {
        val id = UUID.randomUUID()
        c.prepareStatement(
            "INSERT INTO tools (id,workspace_id,environment_id,name,slug,type,description,status) " +
                "VALUES (?,?,?,?,?,'http','Searches the web.','active')"
        ).use {
            it.setObject(1, id); it.setObject(2, world.workspaceId); it.setObject(3, world.environmentId)
            it.setString(4, name); it.setString(5, "$name-$id"); it.executeUpdate()
        }
        return id
    }

    private fun agent(
        c: java.sql.Connection, world: World, name: String, tools: List<UUID> = emptyList(),
    ) {
        val id = UUID.randomUUID()
        c.prepareStatement(
            "INSERT INTO agents (id,workspace_id,environment_id,name,slug,type,instructions," +
                " llm_connection_id,model_name,temperature,max_tokens,max_iterations," +
                " max_tool_calls,max_cost_cents,status,allowed_tool_ids) " +
                "VALUES (?,?,?,?,?,'iterative_agent',?,?,'gpt-4o-mini',0.2,2048,8,5,500,'active',?)"
        ).use {
            it.setObject(1, id); it.setObject(2, world.workspaceId); it.setObject(3, world.environmentId)
            it.setString(4, name); it.setString(5, "$name-$id")
            it.setString(6, "You are $name.")
            it.setObject(7, world.llmConnectionId)
            it.setArray(8, c.createArrayOf("text", tools.map { t -> t.toString() }.toTypedArray()))
            it.executeUpdate()
        }
        world.agents[name] = id
    }

    private fun roster(c: java.sql.Connection, world: World, from: String, vararg to: String) {
        c.prepareStatement("UPDATE agents SET can_delegate_to = ? WHERE id = ?").use {
            it.setArray(1, c.createArrayOf("text", to.map { n -> world[n].toString() }.toTypedArray()))
            it.setObject(2, world[from]); it.executeUpdate()
        }
    }

    /**
     * What `POST /api/skill-catalog/:slug/install` does, in SQL.
     *
     * The API owns the route; the worker's module cannot call it. What matters
     * for this test is that the text and the required-tool bindings are the ones
     * a real install produces, which is why the text is READ from the catalogue
     * rather than written here.
     */
    private fun installFromCatalogue(
        c: java.sql.Connection, world: World, slug: String, bindings: Map<String, UUID>,
    ): UUID {
        val (name, summary, instructions, contract, capabilities) = c.prepareStatement(
            """SELECT name, summary, instructions, output_contract, required_capabilities_json::text
                 FROM skill_catalog_entries WHERE slug = ? ORDER BY version DESC LIMIT 1"""
        ).use { st ->
            st.setString(1, slug)
            st.executeQuery().use { rs ->
                assertTrue(rs.next(), "the migration did not seed the '$slug' catalogue entry")
                Quintuple(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5))
            }
        }

        val required = mapper.readTree(capabilities).map { cap ->
            val key = cap.get("key").asText()
            val toolId = bindings[key] ?: error("capability '$key' of '$slug' was not bound to a tool")
            mapOf("toolId" to toolId.toString(), "label" to cap.get("label").asText())
        }

        val skillId = UUID.randomUUID()
        val versionId = UUID.randomUUID()
        c.prepareStatement(
            """INSERT INTO skills (id, workspace_id, environment_id, name, slug, description,
                 provenance, current_version, status)
               VALUES (?,?,?,?,?,?,'first_party',1,'active')"""
        ).use {
            it.setObject(1, skillId); it.setObject(2, world.workspaceId); it.setObject(3, world.environmentId)
            it.setString(4, name); it.setString(5, slug); it.setString(6, summary)
            it.executeUpdate()
        }
        c.prepareStatement(
            """INSERT INTO skill_versions (id, skill_id, workspace_id, version, name, summary,
                 instructions, output_contract, examples_json, required_tools_json)
               VALUES (?,?,?,1,?,?,?,?,'[]'::jsonb,?::jsonb)"""
        ).use {
            it.setObject(1, versionId); it.setObject(2, skillId); it.setObject(3, world.workspaceId)
            it.setString(4, name); it.setString(5, summary); it.setString(6, instructions)
            it.setString(7, contract); it.setString(8, mapper.writeValueAsString(required))
            it.executeUpdate()
        }
        c.prepareStatement("UPDATE skills SET current_version_id = ? WHERE id = ?").use {
            it.setObject(1, versionId); it.setObject(2, skillId); it.executeUpdate()
        }
        return skillId
    }

    private fun grantSkill(c: java.sql.Connection, world: World, agent: String, slug: String) {
        c.prepareStatement(
            "INSERT INTO agent_skills (agent_id, skill_id, workspace_id, position) VALUES (?,?,?,0)"
        ).use {
            it.setObject(1, world[agent]); it.setObject(2, world.skills.getValue(slug))
            it.setObject(3, world.workspaceId); it.executeUpdate()
        }
    }

    private fun cleanup() = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE run_id=?")
                .use { it.setObject(1, w.runId); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
        }
    }

    private data class Quintuple(
        val a: String, val b: String?, val c: String, val d: String?, val e: String,
    )

    companion object {
        private const val STEP_ID = "n-producer"

        /** A loopback address that is not the one a stray local service is on. */
        private const val TEST_HOST = "127.0.0.2"
    }
}
