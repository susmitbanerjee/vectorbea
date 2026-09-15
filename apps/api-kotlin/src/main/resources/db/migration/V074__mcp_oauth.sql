-- ===========================================================================
-- V074 — signing in to an MCP server
--
-- See docs/MCP-CONNECTOR-UI.md §5 and docs/MCP.md §4a.
--
-- ── WHAT THIS TABLE IS ──────────────────────────────────────────────────────
-- A sign-in in flight: the few minutes between "Sign in" being pressed and the
-- authorization server redirecting back with a code. Nothing about a CONNECTED
-- server lives here — the credential it produces goes into the connection's own
-- secret (`encrypted_secrets`), and refreshed tokens into
-- `connection_oauth_tokens` (V064), exactly like an HTTP tool's.
--
-- ── WHY THE STATE IS STORED HASHED ──────────────────────────────────────────
-- `state` is the only thing the callback carries that ties an anonymous browser
-- redirect to a workspace. It is 32 random bytes and single-use, and the row is
-- keyed by its SHA-256 so that a read of this table — a support query, a backup
-- — cannot be replayed into a callback.
--
-- ── WHY THE CONTEXT IS SEALED ───────────────────────────────────────────────
-- It holds the PKCE verifier and, for a server that insists on a confidential
-- client, a client secret. Workspace-bound AES-GCM, the same `Encryption` every
-- other credential in the product goes through (invariant 4: sanitized and
-- sealed at the write boundary, never at read).
--
-- ── WHY ROWS ARE DELETED, NOT MARKED ────────────────────────────────────────
-- Consuming a sign-in is `DELETE … RETURNING`, which is both the single-use
-- guarantee (two callbacks racing on one state cannot both win) and invariant
-- 10's rule: data with no further purpose is removed, not hidden. Abandoned
-- sign-ins are deleted when they expire, on the next start.
--
-- Forward-only and additive. Nothing reads this table outside
-- `McpOAuthPendingRepository`, so an API that predates it is unaffected.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS mcp_oauth_authorizations (
    state_hash         TEXT        PRIMARY KEY,
    workspace_id       UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    connection_id      UUID        NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    started_by_user_id UUID,
    -- Encrypted JSON: { verifier, redirectUri, resource, scope, issuer,
    --   tokenEndpoint, clientId, clientSecret?, tokenEndpointAuthMethod }
    sealed_context     TEXT        NOT NULL,
    -- A path on the web app to send the browser back to. Validated as a
    -- same-origin relative path before it is written; never a full URL.
    return_to          TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS mcp_oauth_authorizations_expires_idx
    ON mcp_oauth_authorizations (expires_at);

COMMENT ON TABLE mcp_oauth_authorizations IS
    'MCP sign-ins in flight. Keyed by SHA-256 of the OAuth state; consumed by '
    'DELETE … RETURNING so a state works once; expired rows are deleted.';
