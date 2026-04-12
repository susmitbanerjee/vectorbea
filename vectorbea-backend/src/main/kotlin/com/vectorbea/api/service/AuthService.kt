package com.vectorbea.api.service

import com.vectorbea.api.auth.ApiKeyHasher
import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.config.Environment
import com.vectorbea.api.model.AuthResult
import com.vectorbea.api.repository.ApiKeyRepository
import java.util.UUID

open class AuthService(
    private val apiKeyRepository: ApiKeyRepository,
    private val environment: Environment = Environment.LOCAL,
) {
    /**
     * Validates a raw Bearer token and returns the resolved [AuthResult], or
     * null if the token is missing / unknown.
     *
     * LOCAL-environment bypass
     * ─────────────────────────
     * When [environment] is [Environment.LOCAL] (i.e. developer laptop / Docker
     * Compose), the hardcoded token `dev_local_123` is accepted without a
     * database lookup and resolves to full ADMIN access on the seeded workspace.
     * This lets the Python SDK and UI work immediately after `docker compose up`
     * without manually creating an API key.
     *
     * The bypass is unconditionally absent in DEV / STAGE / PROD — it is
     * guarded by the [Environment.bypassForbidden] flag so it can never be
     * accidentally activated in a shared or production environment.
     */
    open fun authenticate(rawToken: String): AuthResult? {
        if (rawToken.isBlank()) return null

        if (!environment.bypassForbidden && rawToken == LOCAL_BYPASS_TOKEN) {
            return LOCAL_BYPASS_AUTH
        }

        val keyHash = ApiKeyHasher.sha256(rawToken)
        return apiKeyRepository.findAuthResultByKeyHash(keyHash)
    }

    companion object {
        /** Raw token accepted only in the LOCAL environment. */
        const val LOCAL_BYPASS_TOKEN = "dev_local_123"

        /**
         * Fixed UUIDs that match the rows inserted by `supabase/seed.sql`.
         * They are stable so bookmarks / curl scripts don't break across restarts.
         */
        val LOCAL_ORG_ID: UUID = UUID.fromString("00000000-0000-0000-0001-000000000001")
        val LOCAL_WORKSPACE_ID: UUID = UUID.fromString("00000000-0000-0000-0001-000000000002")
        val LOCAL_USER_ID: UUID = UUID.fromString("00000000-0000-0000-0001-000000000003")

        private val LOCAL_BYPASS_AUTH = AuthResult(
            workspaceId = LOCAL_WORKSPACE_ID,
            organizationId = LOCAL_ORG_ID,
            workspaceRole = WorkspaceRole.ADMIN,
            userId = LOCAL_USER_ID,
        )
    }
}
