package com.vectorbea.worker.durable.archive

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * `TRACE_ARCHIVE_DIR` must not look like it belongs to one customer.
 *
 * ── THE FAILURE THIS PREVENTS ───────────────────────────────────────────────
 * The unit of archiving is a PARTITION — a month of one table across the whole
 * installation. It cannot be per-workspace: the drop gate is per-partition, so a
 * per-tenant export would have to complete for every tenant before any partition
 * could be dropped, and one tenant with an unreachable bucket would stop
 * retention for everybody.
 *
 * So the object key carries no workspace id, and every tenant's traces land in
 * whatever this root points at. Aimed at a location one customer can read, that
 * is a breach with no failure signal anywhere in the system: the export succeeds,
 * the ledger records it, the partitions are dropped, and nothing looks wrong
 * until somebody reads a bucket they should not have been able to read.
 *
 * ── WHY A HEURISTIC IS ACCEPTABLE HERE, WHEN USUALLY IT IS NOT ──────────────
 * Guessing at intent is normally a bad guard. It is worth it when the failure is
 * silent, irreversible and maximal, and the cost of a false positive is one
 * environment variable and a message saying exactly what to do. Those are the
 * terms here.
 *
 * The tests below pin both directions, because a guard that refuses ordinary
 * paths gets deleted and a guard that accepts everything was never a guard.
 */
class ArchiveRootValidationTest {

    private fun refused(root: String) =
        assertFailsWith<IllegalStateException>("expected '$root' to be refused") {
            requireNotTenantScoped(root)
        }

    // ── Refused ──────────────────────────────────────────────────────────────

    /**
     * A UUID in the path is the strongest signal available.
     *
     * Nothing in a shared archive root is named after an id. A workspace id here
     * means somebody templated one in — the mistake, caught at its most literal.
     */
    @Test
    fun `a workspace id in the path is refused`() {
        val e = refused("/mnt/archives/11111111-1111-1111-1111-111111111111/traces")
        assertTrue(e.message!!.contains("11111111-1111-1111-1111-111111111111"),
            "the message must name the offending segment, or the operator has to guess " +
            "which part of their path was objected to")
        assertTrue(e.message!!.contains("EVERY workspace"),
            "the message must say WHY, not just that it refused")
    }

    /**
     * An unsubstituted placeholder is always a mistake, never a preference.
     *
     * Nothing substitutes these. The directory would be created with the braces
     * in its name — so there is no reading of this path under which it is what
     * the author meant.
     */
    @Test
    fun `an unsubstituted placeholder is refused`() {
        refused("/mnt/archives/{workspaceId}/traces")
        refused("/mnt/archives/\${tenant}/traces")
        refused("/mnt/archives/%s/traces")
    }

    /** The weakest of the three signals, and the reason the override exists. */
    @Test
    fun `a per-customer directory is refused`() {
        refused("/mnt/customers/acme/traces")
        refused("/data/tenants/acme")
        refused("/srv/clients/acme/archive")
        refused("/var/lib/workspaces/acme")
    }

    /** Windows separators are paths too. A backslash must not smuggle one past. */
    @Test
    fun `backslash separators are split the same way`() {
        refused("C:\\\\data\\\\customers\\\\acme\\\\traces")
    }

    /** Case is a spelling choice, not a signal. */
    @Test
    fun `the directory check is case-insensitive`() {
        refused("/mnt/Customers/acme")
        refused("/mnt/TENANTS/acme")
    }

    // ── Accepted ─────────────────────────────────────────────────────────────

    /**
     * The paths an operator would actually configure must pass untouched.
     *
     * This is the half that keeps the guard alive. A check that refuses
     * `/var/lib/vectorbea/archive` is one somebody disables on their first
     * deployment, and then it protects nothing.
     */
    @Test
    fun `ordinary archive roots are accepted`() {
        listOf(
            "/var/lib/vectorbea/archive",
            "/mnt/warm-tier",
            "/data/traces",
            "s3-mount/vectorbea-traces-prod",
            "C:\\\\vectorbea\\\\archive",
            "./archive",
        ).forEach { requireNotTenantScoped(it) }
    }

    /**
     * A word that merely CONTAINS a flagged term is not a match.
     *
     * `customer-facing-metrics` is one segment, not the segment `customers`. The
     * check is on whole segments precisely so that a substring cannot trip it —
     * otherwise the false-positive rate is what gets it switched off.
     */
    @Test
    fun `a segment that merely contains a flagged word is accepted`() {
        requireNotTenantScoped("/mnt/customer-facing/archive")
        requireNotTenantScoped("/mnt/workspace-archive")
    }

    /**
     * The refusal names the override, and the override is deliberately verbose.
     *
     * An operator who hits this at 2am needs the escape hatch in the same message
     * as the refusal. It has to be conspicuous in a diff and impossible to set by
     * accident, which is why it is a whole sentence of an env var rather than a
     * flag.
     */
    @Test
    fun `the refusal explains how to override it`() {
        val e = refused("/mnt/customers/acme")
        assertTrue(e.message!!.contains("TRACE_ARCHIVE_ALLOW_SCOPED_PATH"),
            "a guard that refuses without naming its override is a guard somebody " +
            "works around by editing the source")
    }
}
