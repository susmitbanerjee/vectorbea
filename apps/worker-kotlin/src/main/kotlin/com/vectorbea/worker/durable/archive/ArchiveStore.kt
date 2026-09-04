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
 *
 * ── ⚠ ONE STORE HOLDS EVERY TENANT'S DATA ───────────────────────────────────
 * READ THIS BEFORE CONFIGURING `TRACE_ARCHIVE_DIR`.
 *
 * The unit of archiving is a PARTITION — a month of `run_events` or `run_spans`
 * across the whole installation. A partition is not per-workspace and cannot be:
 * the drop gate is per-partition, so a per-tenant export would have to complete
 * for every tenant before any partition could be dropped, and one tenant with an
 * unreachable bucket would stop retention for everyone.
 *
 * So the object key contains no workspace id, and every tenant's traces land in
 * whatever this store points at. That is correct for OUR warm tier — one bucket
 * we operate, holding our own data, read back by us.
 *
 * It is a data breach if this is ever pointed at a location that belongs to, or
 * is readable by, one customer. There is no per-tenant mode and no partial
 * failure that would reveal the mistake: the export succeeds, the ledger records
 * it, and the partitions are dropped. [archiveStoreFromEnv] therefore refuses
 * paths that look tenant-scoped rather than trusting the operator to notice.
 *
 * An implementation that DOES want per-tenant destinations has to change the unit
 * of archiving first. It is not a configuration change.
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
        ?.also { requireNotTenantScoped(it) }
        ?.let { FilesystemArchiveStore(it) }
        ?: UnconfiguredArchiveStore

/**
 * Refuse an archive root that looks like it belongs to one customer.
 *
 * ── WHY A HEURISTIC IS WORTH IT HERE ────────────────────────────────────────
 * Normally a guess about intent is a bad guard. This one earns its place because
 * the failure it prevents is silent, irreversible and maximal: every tenant's
 * traces written into one customer's storage, the ledger recording success, and
 * the source partitions then dropped. There is no later signal — not a failed
 * export, not a missing file, not a complaint — until someone reads a bucket they
 * should not have been able to read.
 *
 * Against that, the cost of a false positive is one environment variable and a
 * message that says exactly what to do about it.
 *
 * Three signals, all of which mean the path was written per-tenant:
 *
 *   1. A segment that is a UUID. Nothing in a shared archive root is named after
 *      an id; a workspace id in the path means somebody templated it in.
 *   2. An unsubstituted placeholder (`{workspace}`, `${tenantId}`, `%s`). Nothing
 *      substitutes these — the directory would be created with the braces in its
 *      name — so this is always a mistake, never a preference.
 *   3. A `customers`/`tenants`/`clients`/`workspaces` segment. The weakest of the
 *      three, and the reason the override exists.
 *
 * `TRACE_ARCHIVE_ALLOW_SCOPED_PATH=true` overrides it. Deliberately verbose: it
 * has to be conspicuous in a diff and impossible to set by accident, and the log
 * line names the segment that triggered it so the reviewer of that diff can see
 * what was waived.
 */
internal fun requireNotTenantScoped(root: String) {
    val segments = root.split('/', '\\').filter { it.isNotBlank() }
    val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-" +
                     "[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\$")
    /* `{anything}` or a printf slot. Written with explicit escapes rather than a
       raw string: `$` opens a template in both kinds of Kotlin string, and a
       regex that silently loses a character here would let the case through. */
    val placeholder = Regex("\\{[^}]*\\}|%[sd]")
    val scoped = setOf("customer", "customers", "tenant", "tenants",
                       "client", "clients", "workspace", "workspaces")

    val offending = segments.firstOrNull {
        uuid.matches(it) || placeholder.containsMatchIn(it) || it.lowercase() in scoped
    } ?: return

    if (System.getenv("TRACE_ARCHIVE_ALLOW_SCOPED_PATH")?.lowercase() == "true") {
        logger("archive-store").warn(
            "[archive] TRACE_ARCHIVE_DIR contains a tenant-scoped segment ('{}') and " +
            "TRACE_ARCHIVE_ALLOW_SCOPED_PATH is set. Every workspace's traces will be " +
            "written here. Confirm this location is not readable by any customer.",
            offending)
        return
    }

    throw IllegalStateException(
        "TRACE_ARCHIVE_DIR ('$root') contains a tenant-scoped path segment ('$offending'). " +
        "The trace archive holds EVERY workspace's data in one location — a partition " +
        "spans all tenants and the object key has no workspace in it — so a per-customer " +
        "path would write all tenants' traces into one customer's storage. " +
        "Point it at a location you operate, or set TRACE_ARCHIVE_ALLOW_SCOPED_PATH=true " +
        "if this path is genuinely not customer-scoped.")
}
