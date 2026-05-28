package com.vectorbea.worker.queue

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.RunProcessor
import io.lettuce.core.Consumer
import io.lettuce.core.RedisBusyException
import io.lettuce.core.StreamMessage
import io.lettuce.core.XReadArgs
import io.lettuce.core.api.sync.RedisCommands
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Redis Streams consumer group worker.
 *
 * Lifecycle:
 *   1. [ensureConsumerGroup] — XGROUP CREATE (idempotent, tolerates BUSYGROUP)
 *   2. [start] — begins the poll loop on a dedicated thread
 *   3. Poll loop: XREADGROUP → parse → submit to thread pool → XACK on success
 *   4. [stop] — signals shutdown; waits for in-flight jobs to finish
 *
 * Error handling:
 *   - Parse errors: XACK the message (malformed jobs can't be retried usefully);
 *     log a warning so the dead message can be inspected.
 *   - Processing errors: caught in [RunProcessor.process]; XACK still happens
 *     (job is moved to failed state in DB). This prevents a bad job from
 *     blocking the stream indefinitely.
 *   - Network errors in the poll loop: logged, then loop retries after a backoff.
 *
 * Pending messages:
 *   On startup, the worker calls XREADGROUP with `>` (new messages only).
 *   Pending message recovery (XAUTOCLAIM / XPENDING) is a TODO for a future
 *   release — see the redelivery note in the poll loop.
 *
 * Thread model:
 *   - One dedicated poll thread (reader loop).
 *   - [ExecutorService] with [WorkerConfig.concurrency] threads for job processing.
 *   - Backpressure: the poll loop checks in-flight count before pulling more messages.
 */
class WorkflowQueueConsumer(
    private val config: WorkerConfig,
    private val redis: RedisCommands<String, String>,
    private val processor: RunProcessor,
) {
    private val log = logger()

    private val running = AtomicBoolean(false)
    private val inFlight = java.util.concurrent.atomic.AtomicInteger(0)

    /** Thread pool for job processing — sized to [WorkerConfig.concurrency]. */
    private val jobPool: ExecutorService = Executors.newFixedThreadPool(config.concurrency) { r ->
        Thread(r).also {
            it.name = "worker-job-${it.id}"
            it.isDaemon = false
        }
    }

    /** Dedicated poll thread — not in the job pool. */
    private lateinit var pollThread: Thread

    /** Consumer identity in the Redis Streams consumer group. */
    private val consumer = Consumer.from(config.queueGroup, config.workerId)

    // ── Startup ───────────────────────────────────────────────────────────────

    /**
     * Create the consumer group if it does not already exist.
     * Uses XGROUP CREATE … MKSTREAM so the stream is created if absent.
     * Tolerates BUSYGROUP error (group already exists).
     *
     * Must be called before [start].
     */
    fun ensureConsumerGroup() {
        try {
            redis.xgroupCreate(
                XReadArgs.StreamOffset.from(config.queueStream, "0"),
                config.queueGroup,
                io.lettuce.core.XGroupCreateArgs.Builder.mkstream(),
            )
            log.info("[queue] consumer group created [stream={}, group={}]",
                config.queueStream, config.queueGroup)
        } catch (e: RedisBusyException) {
            // BUSYGROUP: group already exists — that's fine
            log.info("[queue] consumer group already exists [stream={}, group={}]",
                config.queueStream, config.queueGroup)
        } catch (e: Exception) {
            // Some Redis providers surface BUSYGROUP as a generic exception
            if (e.message?.contains("BUSYGROUP", ignoreCase = true) == true) {
                log.info("[queue] consumer group already exists [stream={}, group={}]",
                    config.queueStream, config.queueGroup)
            } else {
                throw e
            }
        }
    }

    /**
     * Start the poll loop on a background thread.
     * Returns immediately; the loop runs until [stop] is called.
     */
    fun start() {
        running.set(true)
        pollThread = Thread(::pollLoop, "worker-poll")
        pollThread.isDaemon = false
        pollThread.start()
        log.info("[queue] consumer started [stream={}, group={}, consumer={}, concurrency={}]",
            config.queueStream, config.queueGroup, config.workerId, config.concurrency)
    }

    /**
     * Graceful shutdown:
     *   1. Signal the poll loop to stop.
     *   2. Wait for the poll thread to exit.
     *   3. Shut down the job pool, waiting up to [drainTimeoutSeconds] for in-flight jobs.
     */
    fun stop(drainTimeoutSeconds: Long = 30L) {
        log.info("[queue] stopping consumer (drain timeout={}s)…", drainTimeoutSeconds)
        running.set(false)

        if (::pollThread.isInitialized) {
            pollThread.interrupt()
            pollThread.join(drainTimeoutSeconds * 1_000L)
        }

        jobPool.shutdown()
        val drained = jobPool.awaitTermination(drainTimeoutSeconds, TimeUnit.SECONDS)
        if (!drained) {
            log.warn("[queue] job pool did not drain in time — forcing shutdown")
            jobPool.shutdownNow()
        }
        log.info("[queue] consumer stopped")
    }

    // ── Poll loop ─────────────────────────────────────────────────────────────

    private fun pollLoop() {
        log.info("[queue] poll loop started")

        while (running.get()) {
            try {
                // Backpressure: don't pull more than we can handle
                if (inFlight.get() >= config.concurrency) {
                    Thread.sleep(200)
                    continue
                }

                val messages = readMessages()

                if (messages.isNullOrEmpty()) {
                    // Normal: no messages within the blocking window
                    continue
                }

                log.debug("[queue] received {} message(s)", messages.size)

                for (msg in messages) {
                    if (!running.get()) break
                    dispatchMessage(msg)
                }

            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                log.info("[queue] poll loop interrupted — shutting down")
                break
            } catch (e: Exception) {
                if (!running.get()) break
                log.error("[queue] poll loop error: {} — retrying in 2s", e.message)
                Thread.sleep(2_000)
            }
        }

        log.info("[queue] poll loop exited")
    }

    private fun readMessages(): List<StreamMessage<String, String>>? {
        return redis.xreadgroup(
            consumer,
            XReadArgs.Builder.count(config.pollBatchSize.toLong()).block(config.pollBlockMs),
            XReadArgs.StreamOffset.lastConsumed(config.queueStream),
        )
    }

    private fun dispatchMessage(msg: StreamMessage<String, String>) {
        val msgId = msg.id
        val fields = msg.body

        // Parse the job — malformed messages are ack'd and skipped
        val job = try {
            WorkflowRunJob.parse(msgId, fields)
        } catch (e: WorkflowRunJob.ParseException) {
            log.warn("[queue] malformed message — ack-ing to clear [msgId={}]: {}", msgId, e.message)
            ackMessage(msgId)
            return
        }

        inFlight.incrementAndGet()

        jobPool.submit {
            try {
                processor.process(job)
                // XACK on success OR handled failure — prevents message from
                // staying in PEL (Pending Entries List) indefinitely.
                // RunProcessor.process catches all exceptions and writes RUN_FAILED.
                ackMessage(msgId)
            } catch (e: Exception) {
                // Extremely unlikely — processor.process never throws
                log.error("[queue] unexpected exception from processor [msgId={}, runId={}]: {}",
                    msgId, job.runId, e.message, e)
                ackMessage(msgId)
            } finally {
                inFlight.decrementAndGet()
            }
        }
    }

    private fun ackMessage(messageId: String) {
        try {
            redis.xack(config.queueStream, config.queueGroup, messageId)
            log.debug("[queue] XACK [msgId={}]", messageId)
        } catch (e: Exception) {
            log.warn("[queue] XACK failed [msgId={}]: {}", messageId, e.message)
        }
    }
}
