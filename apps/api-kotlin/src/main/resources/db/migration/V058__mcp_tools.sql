-- MCP as an additional tool type, beside http and database.
--
-- ── WHAT MCP IS AND IS NOT ──────────────────────────────────────────────────
-- MCP is a discovery and invocation protocol. An MCP server calling Salesforce
-- makes the same REST call a direct integration would, and returns the same
-- forty fields of nested JSON. It does not improve what comes back — the result
-- contract layer (V056) does that, and MCP results go through it like any other.
--
-- What MCP is worth building for is the product argument: a customer connects
-- their own tools without us writing an integration for each, with one story for
-- discovery, auth and errors. It is ADDITIVE. A customer with a plain REST
-- endpoint must not have to wrap it in an MCP server first, so `http` and
-- `database` stay exactly as they are.
--
-- ── THE GRANT MODEL IS THE WHOLE SECURITY DESIGN ────────────────────────────
-- A discovered MCP tool becomes its own row in `tools`. Not a synthetic id under
-- a server row, and not a flag meaning "this server is allowed" — a row, with a
-- uuid, granted to an agent exactly like every other tool.
--
-- That makes a server-level grant structurally impossible rather than merely
-- discouraged: `agents.allowed_tool_ids` holds TOOL ids, an MCP server is a
-- CONNECTION, and there is no column anywhere that could express "all tools from
-- this server". Adding one later would be the change to argue about; today the
-- schema cannot say it.
--
-- It also means the roster model is unchanged. `AgentSafetyGuard.validateToolAllowed`
-- reads our own database and knows nothing about MCP.

-- Which server a tool came from, and what it is called there.
--
-- `mcp_server_connection_id` is a FK to the connection, so revoking the
-- connection revokes every tool discovered through it — the one server-level
-- action that should exist, expressed as removing the credential rather than as
-- a grant.
ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS mcp_server_connection_id UUID,
    ADD COLUMN IF NOT EXISTS mcp_tool_name TEXT,
    -- Set when discovery last saw this tool advertised. A tool the server has
    -- stopped advertising keeps its row and its grants, and fails at call time
    -- with a legible cause — silently deleting a granted tool would change what
    -- an agent can do without anyone deciding to.
    ADD COLUMN IF NOT EXISTS mcp_last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN tools.mcp_server_connection_id IS
    'The MCP connection this tool was discovered through. One row per REMOTE '
    'TOOL, never per server: grants are per tool, and there is deliberately no '
    'way to express a server-level grant.';

CREATE INDEX IF NOT EXISTS tools_mcp_server_idx
    ON tools (mcp_server_connection_id) WHERE mcp_server_connection_id IS NOT NULL;

-- One remote tool per server, so re-discovery updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS tools_mcp_unique_idx
    ON tools (mcp_server_connection_id, mcp_tool_name)
    WHERE mcp_server_connection_id IS NOT NULL;

-- ── THE MANIFEST CACHE ──────────────────────────────────────────────────────
--
-- Discovery is an outbound call to somebody else's server, and it happens
-- whenever an agent's tool list is built. Without a cache, one unreachable
-- customer server would add its whole timeout to every run that could have used
-- it — a failure isolation problem wearing a performance hat.
--
-- Postgres and not Redis: the manifest has to survive a Redis flush, because the
-- alternative on a cold cache is a synchronous call to every configured server
-- at once. `fetched_at` plus a TTL in code rather than a Postgres TTL, so the
-- staleness policy is readable next to the code that applies it.
CREATE TABLE IF NOT EXISTS mcp_server_manifests (
    connection_id  UUID PRIMARY KEY,
    workspace_id   UUID        NOT NULL,
    -- Sanitized at the write boundary, per invariant 4. What is stored here has
    -- already had its descriptions capped and stripped: a customer's server is
    -- untrusted input, its tool descriptions reach the model's prompt, and the
    -- prompt is the injection surface.
    tools_json     JSONB       NOT NULL DEFAULT '[]',
    resources_json JSONB       NOT NULL DEFAULT '[]',
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Why the last discovery failed, if it did. Kept alongside a stale manifest
    -- rather than replacing it: a server that is briefly down should keep serving
    -- its known tools, and the reason should still be visible.
    last_error     TEXT,
    last_error_at  TIMESTAMPTZ
);

COMMENT ON TABLE mcp_server_manifests IS
    'Cached MCP discovery, per connection. Contents are SANITIZED before they are '
    'written: a customer MCP server is untrusted, and its tool descriptions reach '
    'the model prompt.';

CREATE INDEX IF NOT EXISTS mcp_server_manifests_workspace_idx
    ON mcp_server_manifests (workspace_id);

-- Every MCP tool an agent could be granted, with its server's health.
--
-- The granting UI's query, and the answer to "which of my tools stopped being
-- advertised".
CREATE OR REPLACE VIEW mcp_tools_available AS
    SELECT t.workspace_id,
           t.id                AS tool_id,
           t.name,
           t.description,
           t.mcp_tool_name,
           t.mcp_server_connection_id,
           c.name              AS server_name,
           t.mcp_last_seen_at,
           m.fetched_at        AS manifest_fetched_at,
           m.last_error        AS server_last_error,
           (t.mcp_last_seen_at IS NULL
             OR t.mcp_last_seen_at < now() - interval '7 days') AS possibly_withdrawn
      FROM tools t
      JOIN connections c ON c.id = t.mcp_server_connection_id
      LEFT JOIN mcp_server_manifests m ON m.connection_id = t.mcp_server_connection_id
     WHERE t.mcp_server_connection_id IS NOT NULL
       AND t.status = 'active';

COMMENT ON VIEW mcp_tools_available IS
    'MCP tools available for granting, one row per REMOTE TOOL. There is no '
    'server-level row here by design — granting is per tool.';
