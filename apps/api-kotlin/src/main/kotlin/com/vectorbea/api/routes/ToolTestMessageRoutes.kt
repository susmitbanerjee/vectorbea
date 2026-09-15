package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.audit.AuditLog
import com.vectorbea.api.connector.TestMessageSender
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.secrets.SecretDecryptionException
import com.vectorbea.api.secrets.SecretNotFoundException
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.secrets.SecretServiceUnavailableException
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * `POST /api/tools/test-message` — the "Send test message" button in Register a
 * tool. It POSTS A REAL MESSAGE; see [TestMessageSender] for why that is a
 * separate action from the side-effect-free validate.
 *
 * Gated at TOOL_WRITE, not CONNECTION_TEST: the person registering the tool is a
 * developer, and a developer who registers a Slack tool can already make it post
 * by running a workflow — this reaches nothing that did not. Every send is
 * audited, delivered or not, because it is a message in somebody's channel.
 */
class ToolTestMessageRoutes(
    private val connectionRepo: ConnectionRepository,
    private val secretService: SecretService,
    private val audit: AuditLog? = null,
    private val sender: TestMessageSender = TestMessageSender(),
) {
    private val log = LoggerFactory.getLogger(ToolTestMessageRoutes::class.java)

    data class Body(
        val connectionId: String? = null,
        val operationId: String? = null,
        /** Values for the operation's parameters: the channel and the text. */
        val parameters: Map<String, Any?>? = null,
    )

    fun register(router: Router) {
        router.post("/api/tools/test-message", ::send)
    }

    private fun send(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<Body>()
        val connectionId = runCatching { UUID.fromString(body.connectionId) }.getOrNull()
            ?: throw ApiError.ValidationError("connectionId must be a valid UUID")
        val operationId = body.operationId?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("operationId is required")

        val connection = connectionRepo.findById(connectionId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Connection")

        val secret = connection.secretRef?.takeIf { it.isNotBlank() }?.let { ref ->
            try {
                secretService.resolveSecretForRuntime(ref, connection.workspaceId)
            } catch (e: SecretServiceUnavailableException) {
                null
            } catch (e: SecretNotFoundException) {
                null
            } catch (e: SecretDecryptionException) {
                log.error("Secret decryption failed for test message [connectionId={}]", connectionId)
                null
            }
        }

        val parameters = (body.parameters ?: emptyMap())
            .mapNotNull { (k, v) -> (v as? String ?: v?.toString())?.let { k to it } }
            .toMap()

        val outcome = sender.send(connection.provider, connection.authType, secret, operationId, parameters)
        log.info("Test message [connectionId={}, operation={}, delivered={}, code={}]",
            connectionId, operationId, outcome.delivered, outcome.errorCode)

        audit?.recordUserAction(
            req, ctx.workspaceId, AuditLog.Action.TOOL_TEST_MESSAGE,
            targetType = "connection", targetId = connectionId, environmentId = connection.environmentId,
            after = mapOf("operationId" to operationId, "delivered" to outcome.delivered, "errorCode" to outcome.errorCode),
            result = if (outcome.delivered) AuditLog.Result.SUCCESS else AuditLog.Result.ERROR,
        )

        return Response.ok(outcome.toResponse())
    }
}
