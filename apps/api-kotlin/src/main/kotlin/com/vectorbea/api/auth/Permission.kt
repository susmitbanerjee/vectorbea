package com.vectorbea.api.auth

/**
 * Fine-grained permission system for workspace-scoped operations.
 *
 * Roles map to permission sets:
 *   viewer    → read-only: WORKSPACE_READ, *_READ
 *   developer → viewer + write workflows/agents/tools + run
 *   admin     → developer + connections, schedules, members
 *   owner     → all permissions including workspace destruction
 */
enum class Permission {
    WORKSPACE_READ,
    WORKSPACE_WRITE,      // rename, settings
    WORKSPACE_DELETE,     // owner only

    WORKFLOW_READ,
    WORKFLOW_WRITE,
    WORKFLOW_RUN,
    WORKFLOW_DELETE,

    AGENT_READ,
    AGENT_WRITE,
    AGENT_DELETE,

    TOOL_READ,
    TOOL_WRITE,
    TOOL_DELETE,

    CONNECTION_READ,
    CONNECTION_WRITE,
    CONNECTION_DELETE,
    CONNECTION_TEST,

    RUN_READ,
    RUN_CANCEL,

    APPROVAL_READ,
    APPROVAL_DECIDE,

    SCHEDULE_READ,
    SCHEDULE_WRITE,

    WORKER_READ,

    MEMBER_READ,
    MEMBER_MANAGE,        // invite/remove/change role (not owner)
    MEMBER_OWNER_TRANSFER,// owner only

    SETTINGS_READ,
    SETTINGS_WRITE,

    SECRET_READ,          // see that a secret exists (no plaintext)
    SECRET_WRITE,         // create / rotate secrets
}

private val VIEWER_PERMISSIONS = setOf(
    Permission.WORKSPACE_READ,
    Permission.WORKFLOW_READ,
    Permission.AGENT_READ,
    Permission.TOOL_READ,
    Permission.CONNECTION_READ,
    Permission.RUN_READ,
    Permission.APPROVAL_READ,
    Permission.SCHEDULE_READ,
    Permission.WORKER_READ,
    Permission.MEMBER_READ,
    Permission.SETTINGS_READ,
    Permission.SECRET_READ,
)

private val DEVELOPER_PERMISSIONS = VIEWER_PERMISSIONS + setOf(
    Permission.WORKFLOW_WRITE,
    Permission.WORKFLOW_RUN,
    Permission.WORKFLOW_DELETE,
    Permission.AGENT_WRITE,
    Permission.AGENT_DELETE,
    Permission.TOOL_WRITE,
    Permission.TOOL_DELETE,
    Permission.RUN_CANCEL,
    Permission.APPROVAL_DECIDE,
)

private val ADMIN_PERMISSIONS = DEVELOPER_PERMISSIONS + setOf(
    Permission.WORKSPACE_WRITE,
    Permission.CONNECTION_WRITE,
    Permission.CONNECTION_DELETE,
    Permission.CONNECTION_TEST,
    Permission.SCHEDULE_WRITE,
    Permission.MEMBER_MANAGE,
    Permission.SETTINGS_WRITE,
    Permission.SECRET_WRITE,
)

private val OWNER_PERMISSIONS = ADMIN_PERMISSIONS + setOf(
    Permission.WORKSPACE_DELETE,
    Permission.MEMBER_OWNER_TRANSFER,
)

/** Returns the permission set for a given role string. */
fun permissionsForRole(role: String): Set<Permission> = when (role.lowercase()) {
    "owner"     -> OWNER_PERMISSIONS
    "admin"     -> ADMIN_PERMISSIONS
    "developer" -> DEVELOPER_PERMISSIONS
    "viewer"    -> VIEWER_PERMISSIONS
    else        -> emptySet()
}
