package com.vectorbea.api.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.ingress.RunIngress
import com.vectorbea.api.ingress.SyncRunWaiter
import com.vectorbea.api.ingress.TriggerActor
import com.vectorbea.api.ingress.TriggerSource
import com.vectorbea.api.repository.WorkflowRepository
import org.slf4j.LoggerFactory
import java.time.Duration
import java.util.UUID

/**
 * Vectorbea's workflows, as MCP tools.
 *
 * ── THE INVERSE OF docs/MCP.md ──────────────────────────────────────────────
 * That document is about Vectorbea CALLING an MCP server. This is the other
 * direction: a customer's Claude, their IDE, or an agent they wrote calls a
 * Vectorbea workflow as a tool. It is a small amount of work on top of the run
 * API — `tools/list` is a workflow list and `tools/call` is a synchronous run —
 * and it makes every workflow reachable from everything that speaks MCP.
 *
 * ── WHY IT IS A THIN LAYER AND NOT A SUBSYSTEM ──────────────────────────────
 * A tool call here goes through [RunIngress] like every other ingress, so the
 * quota, the rate limit, the admission control, the metering and the trace are
 * the ones that already exist. The acceptance criterion — that a run started by
 * MCP is indistinguishable from an API run except for its trigger attribute —
 * is true by construction rather than by care, because there is no second path
 * for it to differ from.
 *
 * ── SYNCHRONOUS, BECAUSE A TOOL CALL IS ─────────────────────────────────────
 * An MCP client is inside somebody's agent loop waiting for a value. Returning
 * a run id would make every caller write a polling loop, and most would not.
 * So `tools/call` uses the same bounded wait sync mode uses, and degrades the
 * same way: past the deadline it returns the run id and how to follow it, which
 * is a useful answer rather than a dropped connection.
 */
class McpServer(
    private val workflows: WorkflowRepository,
    private val ingress: RunIngress,
    private val waiter: SyncRunWaiter,
    private val runRepo: com.vectorbea.api.repository.RunRepository,
) {
    private val log = LoggerFactory.getLogger(McpServer::class.java)
    private val mapper = ObjectMapper()

    companion object {
        /**
         * The protocol version this server implements.
         *
         * Echoed back on initialize. A client that asks for a different one is
         * NOT refused: MCP's negotiation is that the server states what it
         * speaks and the client decides, and refusing an unknown version would
         * break every client that ships a newer one before we do.
         */
        const val PROTOCOL_VERSION = "2025-06-18"

        const val SERVER_NAME = "vectorbea"

        /**
         * How long a tool call waits before handing back a run id.
         *
         * Shorter than the sync API's ceiling because an MCP client is inside an
         * agent loop with its own patience, and a tool that blocks for a minute
         * is one the model learns to avoid.
         */
        val CALL_TIMEOUT: Duration = Duration.ofSeconds(30)

        /** JSON-RPC error codes, from the spec. */
        const val PARSE_ERROR = -32700
        const val INVALID_REQUEST = -32600
        const val METHOD_NOT_FOUND = -32601
        const val INVALID_PARAMS = -32602
        const val INTERNAL_ERROR = -32603
    }

    /** Who is calling, resolved from the API key before this is reached. */
    data class Caller(
        val workspaceId: UUID,
        val environmentId: UUID?,
        val userId: UUID?,
        val apiKeyId: UUID?,
    )

    /**
     * Handle one JSON-RPC message.
     *
     * Returns null for a notification — a message with no `id`, which by the
     * spec gets no response at all. Returning an empty object instead is a
     * common mistake and makes strict clients log a protocol error on every
     * `notifications/initialized`.
     */
    fun handle(message: JsonNode, caller: Caller): Map<String, Any?>? {
        val id = message.get("id")
        val isNotification = id == null || id.isNull
        val method = message.get("method")?.asText()

        if (method == null) {
            return if (isNotification) null
            else error(id, INVALID_REQUEST, "The message has no `method`.")
        }

        return try {
            when (method) {
                "initialize" -> ok(id, initialize())
                "notifications/initialized", "notifications/cancelled" -> null
                "ping" -> ok(id, emptyMap<String, Any?>())
                "tools/list" -> ok(id, listTools(caller))
                "tools/call" -> ok(id, callTool(message.get("params"), caller))
                else -> if (isNotification) null else error(
                    id, METHOD_NOT_FOUND,
                    "This server implements initialize, ping, tools/list and tools/call.")
            }
        } catch (e: ApiError) {
            /*
             * A refusal from the ingress — quota, concurrency, an archived
             * workflow. Reported as a JSON-RPC error rather than as a tool result
             * so the CLIENT sees a protocol failure it can retry, instead of the
             * model seeing "your tool returned: quota exceeded" and reasoning
             * about it as though it were data.
             */
            if (isNotification) null else error(id, INTERNAL_ERROR, e.message)
        } catch (e: Exception) {
            log.error("[mcp] {} failed: {}", method, e.message)
            if (isNotification) null else error(id, INTERNAL_ERROR, "The request could not be completed.")
        }
    }

    // ── Methods ──────────────────────────────────────────────────────────────

    private fun initialize(): Map<String, Any?> = mapOf(
        "protocolVersion" to PROTOCOL_VERSION,
        /* Tools only. Declaring resources or prompts we do not serve makes a
           client offer them to a model that then cannot use them. */
        "capabilities" to mapOf(
            "tools" to mapOf("listChanged" to false),
        ),
        "serverInfo" to mapOf(
            "name" to SERVER_NAME,
            "title" to "Vectorbea workflows",
            "version" to (System.getenv("APP_VERSION") ?: "dev"),
        ),
        "instructions" to
            "Each tool is a Vectorbea workflow. Calling one starts a run and waits " +
                "for its result. A long-running workflow returns a run id instead, " +
                "with a link to follow it.",
    )

    private fun listTools(caller: Caller): Map<String, Any?> {
        val page = workflows.list(
            workspaceId = caller.workspaceId,
            environmentId = caller.environmentId,
            status = "active",
            params = com.vectorbea.api.repository.PageParams(pageSize = 100),
        )

        val tools = page.items
            /* A workflow with no published version cannot run, and offering it
               would give the model a tool that fails every time. */
            .filter { it.currentVersionId != null }
            .map { wf ->
                /* One version read per workflow. `tools/list` is called once when
                   a client connects, not per tool call, so this is a handful of
                   indexed reads at session start rather than a hot path. */
                val version = wf.currentVersionId?.let {
                    runCatching { workflows.findVersionById(it) }.getOrNull()
                }
                mapOf(
                    "name" to toolNameFor(wf.slug),
                    "title" to wf.name,
                    "description" to (wf.description?.takeIf { it.isNotBlank() }
                        ?: "Runs the Vectorbea workflow '${wf.name}'."),
                    "inputSchema" to inputSchemaFor(version),
                )
            }
        return mapOf("tools" to tools)
    }

    private fun callTool(params: JsonNode?, caller: Caller): Map<String, Any?> {
        val name = params?.get("name")?.asText()
            ?: throw ApiError.ValidationError("`params.name` is required.")
        val arguments = params.get("arguments")

        val slug = fromToolName(name)
        val wf = workflows.findBySlug(slug, caller.workspaceId)
            ?: return toolError("There is no workflow called '$name' in this workspace.")

        val inputJson = if (arguments == null || arguments.isNull) "{}"
        else mapper.writeValueAsString(arguments)

        val started = ingress.start(RunIngress.Request(
            workspaceId = caller.workspaceId,
            workflowId = wf.id,
            environmentId = wf.environmentId,
            inputJson = inputJson,
            source = TriggerSource.MCP,
            /* An MCP call carries the key's identity, so it counts against the
               acting member's cap exactly like an API call. A key must not be a
               way around a limit — invariant 12. */
            actor = TriggerActor(userId = caller.userId, apiKeyId = caller.apiKeyId),
            /*
             * ── NO IDEMPOTENCY KEY, DELIBERATELY ────────────────────────────
             * MCP has no request id a retry would reuse, and deriving one from
             * the arguments would be wrong in the common case: an agent calling
             * the same tool with the same arguments twice usually MEANS it twice.
             * A client that wants deduplication can pass one through the
             * workflow's own inputs.
             */
            reason = "Called as an MCP tool",
        ))

        return when (val outcome = waiter.await(started.runId, caller.workspaceId, CALL_TIMEOUT)) {
            is SyncRunWaiter.Outcome.Finished -> {
                val run = outcome.run
                val succeeded = run.status == "succeeded" || run.status == "completed"
                if (!succeeded) {
                    return toolError(
                        "The workflow finished as ${run.status}." +
                            (run.errorJson?.let { " $it" } ?: ""))
                }
                content(run.outputJson ?: "{}", meta = mapOf(
                    "runId" to run.id.toString(),
                    "durationMs" to run.durationMs,
                ))
            }

            is SyncRunWaiter.Outcome.StillRunning -> content(
                mapper.writeValueAsString(mapOf(
                    "status" to "running",
                    "runId" to started.runId.toString(),
                    "message" to "This workflow is still going after " +
                        "${outcome.waitedMs / 1000}s. Its run id is " +
                        "${started.runId} — read the result from " +
                        "GET /api/runs/${started.runId} when it finishes.",
                )),
                meta = mapOf("runId" to started.runId.toString(), "incomplete" to true),
            )
        }
    }

    // ── Shapes ───────────────────────────────────────────────────────────────

    /**
     * The tool name a model sees.
     *
     * MCP names are `[a-z0-9_-]`, and a workflow slug already is — but a slug can
     * collide with another server's tool inside a client that merges several. The
     * prefix makes "which server does this tool belong to" answerable from the
     * name alone, which is what a person debugging a wrong tool call actually has.
     */
    private fun toolNameFor(slug: String): String = "workflow_" + slug.replace('-', '_')

    private fun fromToolName(name: String): String =
        name.removePrefix("workflow_").replace('_', '-')

    /**
     * The arguments a workflow takes.
     *
     * ── AND THE HONEST ANSWER WHEN THERE IS NO CONTRACT ─────────────────────
     * `workflow_versions.input_schema_json` is the declared contract, and most
     * workflows leave it empty. Deriving a schema from the graph instead would
     * produce a confident, wrong contract that a model would then obey — worse
     * than an open one, because the model would omit fields the workflow needs
     * and never learn why the run failed.
     *
     * So a workflow that declares a schema gets it, and one that does not gets
     * an open object that SAYS so. A model reading that will ask what to send,
     * which is the correct behaviour when nobody has specified.
     */
    @Suppress("UNCHECKED_CAST")
    private fun inputSchemaFor(
        version: com.vectorbea.api.repository.WorkflowVersion?,
    ): Map<String, Any?> {
        val declared = version?.inputSchemaJson?.let { raw ->
            runCatching { mapper.readValue(raw, Map::class.java) as Map<String, Any?> }.getOrNull()
        }
        /* `{}` is what an undeclared schema stores, and it is NOT a valid empty
           schema for this purpose: a client would read it as "no constraints" and
           render no argument fields at all. It has to be the open object below,
           which carries the explanation. */
        if (!declared.isNullOrEmpty()) return declared

        return mapOf(
            "type" to "object",
            "properties" to emptyMap<String, Any?>(),
            "additionalProperties" to true,
            "description" to
                "This workflow does not declare an input schema. Whatever object you " +
                    "pass is delivered to the run as its input.",
        )
    }

    /** A successful tool result. Text content, because that is what every client renders. */
    private fun content(text: String, meta: Map<String, Any?>): Map<String, Any?> = mapOf(
        "content" to listOf(mapOf("type" to "text", "text" to text)),
        "isError" to false,
        "_meta" to meta,
    )

    /**
     * A tool result that says the tool failed.
     *
     * `isError: true` inside a RESULT, not a JSON-RPC error: the distinction is
     * the whole of MCP's error model. A protocol error means the call could not
     * be made and the client should handle it; a tool error means the call was
     * made and failed, and the MODEL should see it and decide what to do. A
     * workflow that failed is the second kind.
     */
    private fun toolError(message: String): Map<String, Any?> = mapOf(
        "content" to listOf(mapOf("type" to "text", "text" to message)),
        "isError" to true,
    )

    private fun ok(id: JsonNode?, result: Any?): Map<String, Any?> = mapOf(
        "jsonrpc" to "2.0",
        "id" to idValue(id),
        "result" to result,
    )

    private fun error(id: JsonNode?, code: Int, message: String): Map<String, Any?> = mapOf(
        "jsonrpc" to "2.0",
        "id" to idValue(id),
        "error" to mapOf("code" to code, "message" to message),
    )

    /** JSON-RPC ids are a string, a number, or null — and the reply must echo the type. */
    private fun idValue(id: JsonNode?): Any? = when {
        id == null || id.isNull -> null
        id.isTextual -> id.asText()
        id.isIntegralNumber -> id.asLong()
        id.isNumber -> id.asDouble()
        else -> id.asText()
    }
}
