package com.vectorbea.api.auth.rbac

/**
 * Privilege levels within a Workspace, ordered from least to most permissive.
 * Ordinal position is load-bearing — [satisfies] relies on it.
 *
 *   VIEWER  < EDITOR  < ADMIN
 *     0         1         2
 *
 * A role "satisfies" a minimum requirement if its ordinal is >= the minimum's.
 */
enum class WorkspaceRole {
    VIEWER,
    EDITOR,
    ADMIN;

    /**
     * Returns true if this role meets or exceeds [minimum].
     *
     * ```
     * ADMIN.satisfies(EDITOR)  // true  — admin can do editor things
     * EDITOR.satisfies(ADMIN)  // false — editor cannot do admin things
     * VIEWER.satisfies(VIEWER) // true  — exact match
     * ```
     */
    fun satisfies(minimum: WorkspaceRole): Boolean = this.ordinal >= minimum.ordinal

    companion object {
        fun fromString(value: String): WorkspaceRole =
            when (value.lowercase()) {
                "admin"  -> ADMIN
                "editor" -> EDITOR
                "viewer" -> VIEWER
                else     -> throw IllegalArgumentException("Unknown workspace role: $value")
            }
    }
}
