package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.event.EventTrigger
import com.vectorbea.api.event.EventTriggerRepository
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Event triggers: subscribing a workflow to a broker the customer already runs.
 *
 * Management only. The consuming happens in
 * [com.vectorbea.api.event.EventTriggerRunner], which picks a trigger up on its
 * next sweep — so creating one here starts consuming within thirty seconds
 * without a deploy, and disabling one stops it within thirty seconds, which is
 * the direction that matters during an incident.
 */
class EventTriggerRoutes(
    private val triggers: EventTriggerRepository,
) {
    private val log = LoggerFactory.getLogger(EventTriggerRoutes::class.java)

    private companion object {
        val BROKERS = setOf("kafka", "sqs", "pubsub")
    }

    fun register(router: Router) {
        router.get("/api/event-triggers", ::list)
        router.post("/api/event-triggers", ::create)
        router.get("/api/event-triggers/:id", ::get)
        router.delete("/api/event-triggers/:id", ::delete)
        router.post("/api/event-triggers/:id/enable", ::enable)
        router.post("/api/event-triggers/:id/disable", ::disable)
        router.get("/api/event-triggers/:id/deliveries", ::deliveries)
    }

    private data class CreateBody(
        val workflowId: String? = null,
        val name: String? = null,
        val broker: String? = null,
        val connectionId: String? = null,
        val source: String? = null,
        val consumerGroup: String? = null,
        val inputMapping: Map<String, String> = emptyMap(),
        val filterPath: String? = null,
        val filterValues: List<String> = emptyList(),
        val dedupePath: String? = null,
        /**
         * A path naming the THING the run works — `alert.labels.service` — as
         * opposed to `dedupePath`, which names the message.
         *
         * The first stops a broker's redelivery running twice. This stops two
         * different messages about one service starting two runs, and what
         * happens instead is the workflow's `dedupPolicy`.
         */
        val runDedupPath: String? = null,
        /** 0–100, or absent to take the workflow's default. */
        val runPriority: Int? = null,
        val maxInFlight: Int = 10,
        val batchSize: Int = 10,
    )

    private fun create(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<CreateBody>()

        if (body.runPriority != null && body.runPriority !in 0..100) {
            throw ApiError.ValidationError(
                "`runPriority` must be between 0 and 100. 0 is batch, 50 is normal, 100 is the " +
                    "priority lane; a workspace without that entitlement is clamped below it."
            )
        }

        val workflowId = body.workflowId?.let { runCatching { UUID.fromString(it) }.getOrNull() }
            ?: throw ApiError.ValidationError("`workflowId` is required and must be a UUID.")
        val broker = body.broker?.lowercase()
            ?: throw ApiError.ValidationError("`broker` is required.")
        if (broker !in BROKERS) {
            throw ApiError.ValidationError("`broker` must be one of ${BROKERS.joinToString(", ")}.")
        }
        val source = body.source?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError(
                when (broker) {
                    "kafka" -> "`source` is required: the Kafka topic to consume."
                    "sqs" -> "`source` is required: the full SQS queue URL."
                    else -> "`source` is required: the Pub/Sub subscription name, " +
                        "as projects/<project>/subscriptions/<name>."
                })

        /*
         * A dedup path is not required, and the absence is worth saying out loud
         * rather than silently accepting: without one the ledger falls back to
         * the broker's message id, which changes when a message takes a
         * dead-letter route — so the same order can produce two runs. It is a
         * warning rather than a refusal because plenty of queues carry no
         * business key and the fallback is still better than nothing.
         */
        val warning = if (body.dedupePath.isNullOrBlank())
            "No `dedupePath` was set, so deduplication falls back to the broker's own " +
                "message id. That id changes if a message is redelivered through a " +
                "dead-letter queue, which can produce a second run for one event."
        else null

        val trigger = triggers.create(
            workspaceId = ctx.workspaceId,
            environmentId = ctx.requireEnvironmentId(),
            workflowId = workflowId,
            name = body.name?.takeIf { it.isNotBlank() } ?: "$broker trigger",
            broker = broker,
            connectionId = body.connectionId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
            source = source,
            consumerGroup = body.consumerGroup,
            inputMapping = body.inputMapping,
            filterPath = body.filterPath,
            filterValues = body.filterValues,
            dedupePath = body.dedupePath,
            runDedupPath = body.runDedupPath?.takeIf { it.isNotBlank() },
            runPriority = body.runPriority?.toShort(),
            maxInFlight = body.maxInFlight,
            batchSize = body.batchSize,
            createdByUserId = req.principal?.appUserId,
        )

        log.info("[events] created trigger {} ({} {})", trigger.id, broker, source)
        return Response(201, com.vectorbea.api.http.toJson(buildMap {
            putAll(trigger.toResponse())
            warning?.let { put("warning", it) }
        }), mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val items = triggers.listForWorkspace(ctx.workspaceId)
        return Response.ok(mapOf("items" to items.map { it.toResponse() }, "total" to items.size))
    }

    private fun get(req: Request): Response {
        val ctx = req.context()
        val trigger = triggers.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Event trigger")
        return Response.ok(trigger.toResponse())
    }

    private fun delete(req: Request): Response {
        val ctx = req.context()
        if (!triggers.delete(req.pathUUID("id"), ctx.workspaceId)) {
            throw ApiError.NotFound("Event trigger")
        }
        return Response.ok(mapOf("deleted" to true))
    }

    private fun enable(req: Request) = setEnabled(req, true)
    private fun disable(req: Request) = setEnabled(req, false)

    private fun setEnabled(req: Request, enabled: Boolean): Response {
        val ctx = req.context()
        if (!triggers.setEnabled(req.pathUUID("id"), ctx.workspaceId, enabled)) {
            throw ApiError.NotFound("Event trigger")
        }
        return Response.ok(mapOf(
            "enabled" to enabled,
            "message" to if (enabled)
                "Consuming will start within 30 seconds."
            else
                "Consuming will stop within 30 seconds. Messages stay on the broker.",
        ))
    }

    /** The same debugging surface a webhook has, for the same reason. */
    private fun deliveries(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        triggers.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Event trigger")
        val items = triggers.recentDeliveries(id, ctx.workspaceId)
        return Response.ok(mapOf("items" to items, "total" to items.size))
    }

    private fun EventTrigger.toResponse(): Map<String, Any?> = mapOf(
        "id" to id.toString(),
        "workflowId" to workflowId.toString(),
        "name" to name,
        "broker" to broker,
        "connectionId" to connectionId?.toString(),
        "source" to source,
        "consumerGroup" to consumerGroup,
        "inputMapping" to inputMapping,
        "filterPath" to filterPath,
        "filterValues" to filterValues,
        "dedupePath" to dedupePath,
        "runDedupPath" to runDedupPath,
        "runPriority" to runPriority?.toInt(),
        "maxInFlight" to maxInFlight,
        "batchSize" to batchSize,
        "enabled" to enabled,
        // Why it stopped, if it did. The answer to "my events stopped arriving".
        "disabledReason" to disabledReason,
        "lastError" to lastError,
        "lastMessageAt" to lastMessageAt?.toString(),
        "messagesConsumed" to messagesConsumed,
        "createdAt" to createdAt.toString(),
    )
}
