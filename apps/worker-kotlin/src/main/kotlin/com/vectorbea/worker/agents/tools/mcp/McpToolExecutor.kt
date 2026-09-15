package com.vectorbea.worker.agents.tools.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.mcp.McpClient
import com.vectorbea.mcp.McpCredential
import com.vectorbea.mcp.McpCredentials
import com.vectorbea.mcp.McpDiscovery
import com.vectorbea.mcp.McpSanitizer
import com.vectorbea.worker.agents.tools.ToolErrorShape
import com.vectorbea.worker.agents.tools.ToolResultContract
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.net.ConnectionCircuit
import com.vectorbea.worker.runtime.executor.NodeResult
import java.util.UUID

/**
 * Invoke one remote MCP tool.
 *
 * ── IT IS A TOOL TYPE, NOT A SUBSYSTEM ──────────────────────────────────────
 * This slots into `ToolNodeExecutor`'s existing type dispatch, which is the whole
 * point of that dispatch: adding a type does not change the runtime. An MCP call
 * therefore gets the tool boundary's approval gate, the `TOOL_CALL_*` events, the
 * `tool_call` span with its existing parent, the step guard's idempotency key and
 * the payload store — for free, and identically to an HTTP tool, because it is
 * the same code path.
 *
 * ── WHAT MCP DOES NOT BRING ─────────────────────────────────────────────────
 * A better result. An MCP server calling Salesforce returns the same forty fields
 * of nested JSON a direct integration would, so the result goes through the same
 * result-contract layer as everything else. Where the server supplies annotations
 * those become the DEFAULT contract; a locally-authored one overrides them,
 * because the customer's agent knows what it needs and the server author does
 * not.
 *
 * ── FAILURE ISOLATION IS THE POINT OF THE ERROR HANDLING ────────────────────
 * A customer's server being unreachable must produce a TOOL ERROR for the tools
 * that server provides, and nothing else. Not a run failure, not a node failure
 * that ends the agent, and never a failure for a run that happens to be executing
 * nearby. Every exit below is `NodeResult.Completed` carrying an error shape, or
 * `NodeResult.Failed` for the one case where the tool is genuinely misconfigured.
 */
class McpToolExecutor(
    private val connectionResolver: ConnectionResolver,
    private val discovery: McpDiscovery,
    private val client: McpClient = McpClient(WorkerMcpTransport),
    /**
     * Per-server breaker. The same one every other outbound integration uses, so
     * an MCP server that is down stops being called on the same terms as an HTTP
     * endpoint that is down.
     */
    private val circuit: ConnectionCircuit? = null,
    /**
     * Refreshes a signed-in server's token, and persists what it refreshed.
     *
     * Null keeps a connection's secret exactly as it was used before sign-in
     * existed: sent as a bearer token, never refreshed. Production wires one, so
     * a server somebody signed in to last month still answers an agent today —
     * the gap between "discovery found the tools" and "agents can call them"
     * that a one-hour access token would otherwise open on the first run after
     * lunch.
     */
    private val credentials: McpCredentials? = null,
) {
    private val log = logger()
    private val mapper = ObjectMapper()

    /**
     * Call the remote tool named in [mcpToolName] on the server behind
     * [connectionId].
     *
     * Returns a Completed result whose output is the tool's, or — for every
     * failure that is the server's rather than the configuration's — a Completed
     * result carrying an error contract. The distinction matters: a failed CALL is
     * an observation the agent reasons about, while a misconfigured TOOL is
     * something no amount of agent reasoning fixes.
     */
    suspend fun call(
        connectionId: UUID,
        mcpToolName: String,
        arguments: Map<String, Any?>,
        workspaceId: UUID,
        toolContract: ToolResultContract?,
        timeoutMs: Long?,
    ): NodeResult {
        val resolved = try {
            connectionResolver.resolve(connectionId, workspaceId)
        } catch (e: Exception) {
            /* The connection is gone or not ours. Nothing the agent does fixes
               this, so it is a node failure rather than an observation. */
            return NodeResult.Failed(
                "MCP tool '$mcpToolName': its server connection could not be resolved " +
                "(${e.javaClass.simpleName}).")
        }

        val serverUrl = listOf("serverUrl", "server_url", "url", "baseUrl", "base_url")
            .firstNotNullOfOrNull { resolved.record.configJson[it] as? String }
            ?.takeIf { it.isNotBlank() }
            ?: return NodeResult.Failed(
                "MCP tool '$mcpToolName': its connection has no server URL configured.")

        /* Fail fast when this server is already known to be down, rather than
           burning the full timeout per call to rediscover it. */
        try {
            circuit?.beforeCall(connectionId)
        } catch (e: ConnectionCircuit.CircuitOpenException) {
            return errorObservation(ToolErrorShape(
                kind = "server", retryable = true,
                what = "The MCP server for '$mcpToolName' is temporarily unavailable " +
                       "and calls to it are paused.",
                fix = "It failed repeatedly and is being given time to recover. " +
                      "Other tools are unaffected."))
        }

        val fromSecret = credentialOf(resolved)
        val credential = try {
            credentials?.current(workspaceId, connectionId, fromSecret) ?: fromSecret
        } catch (e: McpCredentials.ReauthorizationRequired) {
            return errorObservation(signInAgain(mcpToolName, e.message))
        }

        val server = McpClient.Server(
            connectionId = connectionId,
            url = serverUrl,
            transport = (resolved.record.configJson["transport"] as? String) ?: "streamable-http",
            authToken = McpCredentials.tokenOf(credential),
            timeoutMs = timeoutMs ?: McpClient.DEFAULT_TIMEOUT_MS,
        )

        val result = try {
            try {
                client.callTool(server, mcpToolName, arguments)
            } catch (e: McpClient.McpAuthRequiredException) {
                /* Expiry is only the server's promise. A token revoked early, or
                   one issued without `expires_in`, is found out here — refresh
                   once and try again. Safe to repeat: a call refused at the
                   authorization layer never reached the tool. */
                val retried = credentials?.afterRejection(workspaceId, connectionId, fromSecret, credential)
                    ?: return errorObservation(signInAgain(mcpToolName, null))
                client.callTool(server.copy(authToken = retried.accessToken), mcpToolName, arguments)
            }.also { circuit?.onSuccess(connectionId) }
        } catch (e: McpClient.McpAuthRequiredException) {
            /* A refusal, not an outage: the server answered. Kept off the breaker
               for the reason below. */
            return errorObservation(signInAgain(mcpToolName, null))
        } catch (e: McpClient.McpException) {
            /*
             * The breaker sees TRANSPORT failures, not refusals.
             *
             * A server that answers "no such tool" is healthy and answering; a
             * server that cannot be reached is not. Counting a refusal towards the
             * breaker would let one badly-configured tool take a working server
             * offline for every other tool on it — the same distinction the 429
             * path makes for providers.
             */
            if (e.rpcCode == null) circuit?.onFailure(connectionId, e.message ?: "mcp failure")
            return errorObservation(shapeOf(e, mcpToolName))
        } catch (e: Exception) {
            circuit?.onFailure(connectionId, e.javaClass.simpleName)
            return errorObservation(ToolErrorShape(
                kind = "server", retryable = true,
                what = "The MCP tool '$mcpToolName' failed (${e.javaClass.simpleName}).",
                fix = "The server may be temporarily unavailable. Other tools are unaffected."))
        }

        /*
         * An MCP result carries `isError` for a tool that ran and declined — a
         * business-level failure, which is a different thing from the transport
         * failing and needs a different retry story.
         */
        if (result["isError"]?.asBoolean() == true) {
            return errorObservation(ToolErrorShape(
                kind = "invalid_input", retryable = false,
                what = "The MCP tool '$mcpToolName' reported an error: " +
                       (McpSanitizer.text(textOf(result), 300) ?: "no detail given"),
                fix = "Correct the arguments. The same input will be refused again."))
        }

        return NodeResult.Completed(
            output = buildMap {
                /* `content` is MCP's own envelope. Kept under it so a result
                   contract's paths are stable whatever the server returns.
                   Omitted rather than null when the shape could not be read: an
                   absent key reads as "no content", a null reads as a value. */
                normalise(result)?.let { put("content", it) }
                put("mcpTool", mcpToolName)
            },
            metadata = mapOf("mcpTool" to mcpToolName, "transport" to server.transport),
        )
    }

    /**
     * Read one MCP resource.
     *
     * ── WHY RESOURCES MATTER MORE THAN THEY LOOK ────────────────────────────
     * A resource is read-only context an agent pulls when it needs it, which is
     * the `contextRefs` model the delegation work already uses: pass a pointer,
     * let the callee read what it needs, rather than pushing everything into the
     * prompt. The alternative — fetching every resource a server offers and
     * prepending it — is the observation-size problem again, one layer up.
     */
    suspend fun readResource(
        connectionId: UUID, uri: String, workspaceId: UUID,
    ): NodeResult {
        val resolved = try { connectionResolver.resolve(connectionId, workspaceId) }
        catch (e: Exception) {
            return NodeResult.Failed("MCP resource: connection could not be resolved.")
        }
        val serverUrl = listOf("serverUrl", "server_url", "url")
            .firstNotNullOfOrNull { resolved.record.configJson[it] as? String }
            ?: return NodeResult.Failed("MCP resource: connection has no server URL.")

        val fromSecret = credentialOf(resolved)
        val credential = try {
            credentials?.current(workspaceId, connectionId, fromSecret) ?: fromSecret
        } catch (e: McpCredentials.ReauthorizationRequired) {
            return errorObservation(signInAgain("resource $uri", e.message))
        }
        val server = McpClient.Server(connectionId, serverUrl, authToken = McpCredentials.tokenOf(credential))

        return try {
            val r = client.readResource(server, uri)
            NodeResult.Completed(
                output = buildMap<String, Any> {
                    put("uri", uri)
                    normalise(r)?.let { put("contents", it) }
                },
                metadata = mapOf("uri" to uri))
        } catch (e: McpClient.McpException) {
            errorObservation(shapeOf(e, "resource $uri"))
        }
    }

    /** The connection's secret, read once and parsed. A pasted token stays a bearer token. */
    private fun credentialOf(resolved: com.vectorbea.worker.connector.ResolvedConnection): McpCredential? =
        resolved.secret?.let { sv ->
            var t = ""
            sv.useOnce { t = it }
            McpCredential.parse(t)
        }

    /**
     * The one failure an agent cannot work around, stated so it stops trying.
     *
     * Not retryable, and the fix names a PERSON: signing in happens in a browser,
     * and an agent that believes it can recover will spend its iterations
     * rephrasing a call the server will keep refusing.
     */
    private fun signInAgain(what: String, detail: String?) = ToolErrorShape(
        kind = "auth", retryable = false,
        what = "The MCP server for '$what' refused this connection's sign-in.",
        fix = (detail ?: "Someone needs to sign in to the server again from its connection in Vectorbea.") +
              " Other tools are unaffected.",
    )

    // ── Error mapping ────────────────────────────────────────────────────────

    /**
     * An MCP failure, in the shape the agent already understands.
     *
     * The JSON-RPC codes are the specification's; the retry advice is ours, and it
     * is the field that stops an agent looping. `-32601` (method not found) means
     * this server does not implement what we asked — retrying cannot change that,
     * and an agent told so stops instead of rephrasing.
     */
    private fun shapeOf(e: McpClient.McpException, what: String): ToolErrorShape = when {
        e.httpStatus != null -> ToolErrorShape.ofStatus(e.httpStatus, e.message).let {
            it.copy(what = "MCP tool '$what': ${it.what}")
        }
        e.rpcCode == -32601 -> ToolErrorShape(
            kind = "not_found", retryable = false,
            what = "The MCP server does not implement '$what'.",
            fix = "The server no longer advertises this tool. It may have been " +
                  "removed; use a different tool.")
        e.rpcCode == -32602 -> ToolErrorShape(
            kind = "invalid_input", retryable = false,
            what = "The MCP server rejected the arguments for '$what'.",
            fix = "Correct the arguments to match the tool's schema. The same input " +
                  "will be rejected again.")
        e.rpcCode != null -> ToolErrorShape(
            kind = "unknown", retryable = false,
            what = "The MCP server refused '$what' (code ${e.rpcCode}).",
            fix = null)
        else -> ToolErrorShape(
            kind = "server", retryable = true,
            what = "The MCP server for '$what' could not be reached.",
            fix = "The server may be temporarily unavailable. This affects only the " +
                  "tools that server provides.")
    }

    /**
     * A failure the AGENT sees, not a failure of the run.
     *
     * `Completed` with an error payload rather than `Failed`, which is item 8: an
     * unreachable server is an observation the agent reasons about — it can try a
     * different approach — and never something that ends the run.
     */
    private fun errorObservation(shape: ToolErrorShape): NodeResult =
        NodeResult.Completed(
            output = mapOf(
                "error" to shape.kind,
                "retryable" to shape.retryable,
                "message" to shape.asObservation(),
            ),
            metadata = mapOf("mcpError" to shape.kind, "retryable" to shape.retryable),
        )

    /** MCP wraps results in a `content` array of typed parts. Flatten sensibly. */
    private fun normalise(result: JsonNode): Any? {
        val content = result["content"] ?: result["contents"] ?: return mapper.convertValue(
            result, Map::class.java)
        if (!content.isArray) return mapper.convertValue(content, Map::class.java)
        val parts = content.mapNotNull { part ->
            when (part["type"]?.asText()) {
                /* A text part is often JSON in a string. Parsed when it is, so a
                   result contract's paths address the data rather than a blob. */
                "text" -> part["text"]?.asText()?.let { t ->
                    runCatching { mapper.readTree(t) }.getOrNull()
                        ?.takeIf { it.isObject || it.isArray } ?: t
                }
                "resource" -> part["resource"]
                else -> part
            }
        }
        return if (parts.size == 1) parts.first() else parts
    }

    private fun textOf(result: JsonNode): String? =
        result["content"]?.firstOrNull { it["type"]?.asText() == "text" }?.get("text")?.asText()
            ?: result["message"]?.asText()
}
