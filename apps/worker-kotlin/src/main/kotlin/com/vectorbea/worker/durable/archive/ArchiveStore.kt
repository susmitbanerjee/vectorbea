package com.vectorbea.worker.durable.archive

import com.vectorbea.worker.logging.logger
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption

/**
 * Where the warm tier's bytes live.
 *
 * ── WHY THIS TAKES A WRITER AND NOT A ByteArray ─────────────────────────────
 * `PayloadBlobStore` next door takes `put(key, bytes)`, and it is right to: a
 * payload is a prompt or a tool result, kilobytes at most. A trace partition is
 * a month of one table. Materialising that as a `ByteArray` to hand it over
 * would put the whole export on the heap, and the first partition big enough to
 * be worth archiving would be the one that OOMs the worker.
 *
 * So the store hands out a stream and the caller writes into it. Every real
 * backing store supports that — a file, an S3 multipart upload, a pipe to a
 * sidecar — and none of them need the whole object in memory.
 *
 * ── WHY THIS IS NOT PayloadBlobStore ────────────────────────────────────────
 * Same reason `PayloadBlobStore` is not `replay.BlobStore`: different lifecycle.
 * A payload expires with its workspace's `log_retention_days`. An archive is the
 * ONLY remaining copy once its partition is dropped, so it must outlive
 * everything, and its deletion is a compliance action rather than a cleanup.
 * Merging them would put an object that must never be garbage-collected behind
 * a store designed to expire things.
 */
interface ArchiveStore {
    /**
     * Write an object under [key]. Returns the number of bytes written.
     *
     * Must be ATOMIC from a reader's point of view: a reader either sees the
     * complete object or does not see it at all. A half-written archive that a
     * later run treats as present is how a partition gets dropped against an
     * export that never finished.
     */
    fun put(key: String, write: (OutputStream) -> Unit): Long

    /** True when [key] already holds a complete object. */
    fun exists(key: String): Boolean

    /** Human-readable, for the log line that says where things went. */
    val description: String
}

/**
 * The shipped implementation: a directory.
 *
 * ── WHY A DIRECTORY IS NOT A CONSOLATION PRIZE ──────────────────────────────
 * There is no object-storage client in this build, and adding one is a
 * dependency decision rather than an implementation detail. A directory is not a
 * stand-in for the bucket — it IS the bucket when the directory is a mounted
 * volume, and it is what a sidecar syncing to S3 reads. The seam above is what
 * makes replacing it a class rather than a migration.
 *
 * Writes to `<key>.part` and renames. On every filesystem this codebase runs on,
 * a rename within one directory is atomic, so [exists] never sees a partial
 * object.
 */
class FilesystemArchiveStore(root: String) : ArchiveStore {
    private val log = logger()
    private val base: Path = Paths.get(root).toAbsolutePath().normalize()

    override val description: String get() = "filesystem:$base"

    override fun put(key: String, write: (OutputStream) -> Unit): Long {
        val target = resolve(key)
        Files.createDirectories(target.parent)
        val tmp = target.resolveSibling(target.fileName.toString() + ".part")
        try {
            Files.newOutputStream(tmp).use(write)
            val size = Files.size(tmp)
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE)
            log.info("[archive] wrote {} ({} bytes)", target, size)
            return size
        } catch (e: Exception) {
            runCatching { Files.deleteIfExists(tmp) }
            throw e
        }
    }

    override fun exists(key: String): Boolean = Files.isRegularFile(resolve(key))

    /**
     * Resolve [key] under [base], refusing anything that escapes it.
     *
     * The keys are built from a partition name this codebase generates, so this
     * is not defending against a hostile caller today. It is defending against
     * the day someone makes the key configurable, which is the day `..` in a
     * prefix would start writing outside the archive root.
     */
    private fun resolve(key: String): Path {
        val p = base.resolve(key).normalize()
        require(p.startsWith(base)) { "archive key escapes the archive root: $key" }
        return p
    }
}

/**
 * The default when no archive root is configured: refuse, loudly, rather than
 * pretend.
 *
 * A no-op store that silently claimed success would be the worst possible
 * default here, because [TraceArchiver] writes a ledger row on success and
 * `PartitionMaintenance` treats that row as permission to DROP. Saying "yes I
 * stored it" when nothing was stored would convert an unconfigured deployment
 * into data loss.
 */
object UnconfiguredArchiveStore : ArchiveStore {
    override val description: String get() = "unconfigured"
    override fun put(key: String, write: (OutputStream) -> Unit): Long =
        throw IllegalStateException(
            "No archive store configured. Set TRACE_ARCHIVE_DIR to a directory (a mounted " +
            "bucket, or a path a sidecar syncs) before enabling trace archiving.")
    override fun exists(key: String): Boolean = false
}

/** Pick a store from the environment. */
fun archiveStoreFromEnv(): ArchiveStore =
    System.getenv("TRACE_ARCHIVE_DIR")?.takeIf { it.isNotBlank() }
        ?.let { FilesystemArchiveStore(it) }
        ?: UnconfiguredArchiveStore
