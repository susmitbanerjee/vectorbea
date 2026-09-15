-- =============================================================================
-- V064__http_tool_spec_and_openapi_import.sql
--
-- The HTTP tool resolver, rebuilt — and the spec import that fills it in.
--
-- ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
-- `tools.config_json` held a handful of loose keys that `HttpNodeExecutor` read
-- directly: `url`, `method`, `headers`, `body`. Four consequences followed, and
-- each ruled out a category of API rather than merely making it awkward:
--
--   · The body was JSON-serialised with `Content-Type: application/json` hard
--     coded, so POST worked only against services that accept JSON. Stripe takes
--     form encoding; every upload takes multipart. Neither was expressible.
--   · Auth was `connections.auth_type`, and `api_key` meant the header
--     `x-api-key`, always. A service reading `api_key` — the name in a large
--     share of published OpenAPI documents — could not be called at all.
--   · There was one name per parameter, so the model saw the vendor's wire
--     names, and a header parameter could not be produced from an argument.
--   · There was no response extraction, so the projection layer (V056) had
--     nothing upstream shaping what it projected.
--
-- ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
-- `tools.http_spec_json` is one versioned document describing the whole call:
-- method, path, per-input wire mapping and location, body encoding, auth
-- STRATEGY, response extraction and error mapping, pagination, retry,
-- idempotency and transport. `HttpToolSpec` is its reader, compiled by both
-- services so the API cannot generate a document the worker will not execute.
--
-- JSONB and not columns, for the same reason V056 gave: the shape is a contract
-- between a tool author and a runtime, it will grow, and every growth would
-- otherwise be a migration.
--
-- NULL means "no spec": the tool keeps the legacy keys and behaves exactly as it
-- does today. That is the migration — nothing is rewritten, and the deploy that
-- ships this changes no tool's behaviour.
-- =============================================================================

ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS http_spec_json JSONB;

COMMENT ON COLUMN tools.http_spec_json IS
    'The whole HTTP call this tool makes: method, path, input-to-wire mapping, '
    'body encoding, auth strategy, response extraction, error mapping, '
    'pagination, retry, idempotency and transport. NULL means the tool uses the '
    'legacy config_json keys and behaves exactly as it did. Never contains a '
    'credential — auth names fields of the connection''s secret. See HttpToolSpec.';

CREATE INDEX IF NOT EXISTS tools_with_http_spec_idx
    ON tools (workspace_id) WHERE http_spec_json IS NOT NULL;

-- ---------------------------------------------------------------------------
-- tool_versions
--
-- ── WHY A TOOL NEEDS VERSIONS AND DID NOT BEFORE ───────────────────────────
-- Until now a tool was edited in place and `updated_at` was its version. That
-- is defensible while a human edits one tool at a time. It stops being
-- defensible the moment a spec RE-IMPORT can rewrite forty tools at once:
-- `agents.allowed_tool_ids` grants a tool by id, and an id whose behaviour
-- changed underneath it is a grant to something nobody reviewed.
--
-- The failure is concrete. An agent is granted `create_refund`, scoped by a
-- bound `amount_max`. The vendor publishes a new document; a re-import widens
-- the parameter; the grant still names the same uuid. Nothing in the product
-- would have told anyone.
--
-- So: a change to a granted tool creates a ROW here in `review_state =
-- 'pending'` and does not touch `tools`. Applying it is a deliberate act that
-- copies the row onto the tool and bumps `tools.current_version`. A re-import
-- never mutates a tool in place — never, not merely "not when granted" — because
-- a rule with an exception is a rule somebody's edge case walks through.
--
-- ── IT IS A SNAPSHOT, NOT A DIFF ───────────────────────────────────────────
-- Every column the tool has is copied. Storing diffs would make reconstructing
-- version 7 a fold over six rows, and a fold that must never be wrong about a
-- tool that can spend money is the wrong data structure.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_versions (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tool_id              UUID        NOT NULL REFERENCES tools (id) ON DELETE CASCADE,
    workspace_id         UUID        NOT NULL,
    version              INTEGER     NOT NULL,

    -- The snapshot. Mirrors `tools`, deliberately.
    name                 TEXT        NOT NULL,
    description          TEXT,
    connection_id        UUID,
    input_schema_json    JSONB       NOT NULL DEFAULT '{}',
    output_schema_json   JSONB       NOT NULL DEFAULT '{}',
    config_json          JSONB       NOT NULL DEFAULT '{}',
    http_spec_json       JSONB,
    result_contract_json JSONB,
    risk_level           TEXT        NOT NULL DEFAULT 'low',
    requires_approval    BOOLEAN     NOT NULL DEFAULT false,
    timeout_ms           INTEGER,

    -- 'applied'  — this is (or was) the live definition
    -- 'pending'  — proposed by an import, awaiting review
    -- 'rejected' — reviewed and declined; kept so a re-import does not re-ask
    review_state         TEXT        NOT NULL DEFAULT 'pending',

    -- 'manual' | 'openapi_import' | 'postman_import' | 'migration'
    source               TEXT        NOT NULL DEFAULT 'manual',
    -- The import this came from, when it came from one.
    spec_import_id       UUID,
    -- Human-readable summary of what changed from the previous version.
    change_summary       TEXT,
    -- The machine-readable diff, for the review screen.
    change_json          JSONB,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID,
    applied_at           TIMESTAMPTZ,
    applied_by           UUID,

    CONSTRAINT tool_versions_unique UNIQUE (tool_id, version),
    CONSTRAINT tool_versions_review_state_check
        CHECK (review_state IN ('applied', 'pending', 'rejected')),
    CONSTRAINT tool_versions_source_check
        CHECK (source IN ('manual', 'openapi_import', 'postman_import', 'migration'))
);

CREATE INDEX IF NOT EXISTS tool_versions_tool_idx
    ON tool_versions (tool_id, version DESC);
CREATE INDEX IF NOT EXISTS tool_versions_pending_idx
    ON tool_versions (workspace_id, created_at DESC) WHERE review_state = 'pending';
CREATE INDEX IF NOT EXISTS tool_versions_import_idx
    ON tool_versions (spec_import_id) WHERE spec_import_id IS NOT NULL;

COMMENT ON TABLE tool_versions IS
    'Immutable snapshots of a tool''s definition. A change proposed by a spec '
    're-import lands here as ''pending'' and never touches `tools` until somebody '
    'applies it — because `agents.allowed_tool_ids` grants a tool by id, and an '
    'id whose behaviour changed underneath it is a grant to something nobody '
    'reviewed.';

ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN tools.current_version IS
    'Which `tool_versions.version` is live. Bumped only by applying a version.';

-- ---------------------------------------------------------------------------
-- api_spec_imports
--
-- One imported document. The whole document is kept, and that is the point:
-- item 12 asks for a re-import to produce a DIFF, and a diff needs both sides.
-- Recomputing the old side from the tools it produced cannot work — a tool may
-- have been edited since, and the question "what changed in the SPEC" would then
-- be answered with "what changed in the spec, plus everything you did".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_spec_imports (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    environment_id       UUID        NOT NULL,
    name                 TEXT        NOT NULL,

    -- 'openapi' | 'postman'
    source_kind          TEXT        NOT NULL,
    -- 'upload' | 'url'
    source_type          TEXT        NOT NULL,
    source_url           TEXT,

    -- The document, verbatim, as it was fetched. Normalised to JSON on the way
    -- in so a YAML original and a JSON original diff against each other.
    document_json        JSONB       NOT NULL,
    -- SHA-256 of the document AS FETCHED (bytes, before normalisation), so a
    -- re-import of a byte-identical document is recognised without re-parsing.
    document_sha256      TEXT        NOT NULL,
    document_bytes       INTEGER     NOT NULL DEFAULT 0,

    -- Denormalised for the list screen and for building tools without a re-parse.
    title                TEXT,
    spec_version         TEXT,
    servers_json         JSONB       NOT NULL DEFAULT '[]',
    security_schemes_json JSONB      NOT NULL DEFAULT '{}',
    operation_count      INTEGER     NOT NULL DEFAULT 0,

    -- The connection its tools authenticate through. Item 10: the credential is
    -- prompted for ONCE, here, not per operation.
    connection_id        UUID,

    -- Set when this import supersedes an earlier one for the same API.
    previous_import_id   UUID REFERENCES api_spec_imports (id) ON DELETE SET NULL,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_spec_imports_kind_check
        CHECK (source_kind IN ('openapi', 'postman')),
    CONSTRAINT api_spec_imports_source_check
        CHECK (source_type IN ('upload', 'url'))
);

CREATE INDEX IF NOT EXISTS api_spec_imports_workspace_idx
    ON api_spec_imports (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_spec_imports_digest_idx
    ON api_spec_imports (workspace_id, document_sha256);

-- ---------------------------------------------------------------------------
-- api_spec_operations
--
-- One row per operation in an import, whether or not it became a tool.
--
-- ── WHY THE NOT-SELECTED ONES ARE KEPT ─────────────────────────────────────
-- The diff on re-import has three answers — added, changed, removed — and all
-- three need the previous operation set, not the previous TOOL set. A customer
-- who imported GitHub and made four tools out of nine hundred operations still
-- needs to be told when one of the four changed, and keeping only the four
-- would make "removed" unanswerable for anything they might select next time.
--
-- `fingerprint` is a hash over the parts of an operation that change BEHAVIOUR:
-- method, path, parameters, request body schema, security. Deliberately not the
-- whole operation object — a vendor rewording a `description` must not present
-- as a change requiring review, or the review becomes noise and stops happening.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_spec_operations (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    import_id            UUID        NOT NULL REFERENCES api_spec_imports (id) ON DELETE CASCADE,
    workspace_id         UUID        NOT NULL,

    -- Stable identity across re-imports: the spec's own operationId when it has
    -- one, else `METHOD path`. A document without operationIds is common and
    -- must still diff.
    operation_key        TEXT        NOT NULL,
    method               TEXT        NOT NULL,
    path                 TEXT        NOT NULL,
    summary              TEXT,
    description          TEXT,
    tags                 TEXT[]      NOT NULL DEFAULT '{}',
    deprecated           BOOLEAN     NOT NULL DEFAULT false,

    -- Behaviour hash. See the table comment.
    fingerprint          TEXT        NOT NULL,
    -- The generated spec and schemas, so selecting an operation later needs no
    -- re-parse of a 12 MB document.
    http_spec_json       JSONB,
    input_schema_json    JSONB,
    result_contract_json JSONB,

    -- The tool this operation was turned into, if any.
    tool_id              UUID REFERENCES tools (id) ON DELETE SET NULL,

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT api_spec_operations_unique UNIQUE (import_id, operation_key)
);

CREATE INDEX IF NOT EXISTS api_spec_operations_import_idx
    ON api_spec_operations (import_id);
CREATE INDEX IF NOT EXISTS api_spec_operations_tool_idx
    ON api_spec_operations (tool_id) WHERE tool_id IS NOT NULL;

COMMENT ON COLUMN api_spec_operations.fingerprint IS
    'Hash over the parts of an operation that change BEHAVIOUR — method, path, '
    'parameters, request body schema, security. Not the description: a vendor '
    'rewording prose must not present as a change requiring review, or reviews '
    'become noise and stop happening.';

-- ---------------------------------------------------------------------------
-- connection_oauth_tokens
--
-- Where a refreshed OAuth2 token lives between processes.
--
-- ── ONLY THE AUTHORIZATION-CODE GRANT NEEDS THIS ───────────────────────────
-- A client-credentials token is re-mintable from a secret we already hold, so
-- losing it on deploy costs one token request and it stays in memory only —
-- writing a re-mintable credential to a table is one more place for a live
-- credential to sit, for no benefit.
--
-- An authorization-code REFRESH token is different. Many providers ROTATE it:
-- each refresh returns a new one and retires the old. Keeping that in memory
-- means the next process refreshes with a token the provider has already
-- retired, the refresh fails, and a user who connected months ago is told to
-- reconnect — because of a restart.
--
-- ── ENCRYPTED THE SAME WAY AS EVERY OTHER CREDENTIAL ───────────────────────
-- AES-256-GCM with the workspace id as associated data, through the shared
-- `Encryption` object both services compile. A blob moved into another tenant's
-- row fails to authenticate rather than decrypting. This is the ONE table the
-- worker writes ciphertext to; `encrypted_secrets` remains the API's alone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connection_oauth_tokens (
    workspace_id     UUID        NOT NULL,
    connection_id    UUID        NOT NULL,
    -- {"accessToken": "...", "refreshToken": "..."} encrypted whole.
    token_ciphertext TEXT        NOT NULL,
    expires_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (workspace_id, connection_id)
);

COMMENT ON TABLE connection_oauth_tokens IS
    'Refreshed OAuth2 tokens for user-delegated (authorization-code) '
    'connections. Exists because providers rotate refresh tokens: an in-memory '
    'cache would make every worker restart look like a revoked integration.';

-- ---------------------------------------------------------------------------
-- The review queue, as a view.
--
-- A view rather than a note in a runbook, because "which of my agents are
-- granted a tool with a change waiting" is asked by whoever is deciding whether
-- to apply an import, and they will not reconstruct this join.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tool_versions_pending_review AS
    SELECT v.id                AS version_id,
           v.workspace_id,
           v.tool_id,
           t.name              AS tool_name,
           v.version,
           v.change_summary,
           v.source,
           v.spec_import_id,
           v.created_at,
           -- Whether anything is actually granted this tool. A pending change to
           -- a tool nobody has granted is a chore; to one an agent holds, it is a
           -- security review, and the two should not look alike in a list.
           EXISTS (
               SELECT 1 FROM agents a
                WHERE a.workspace_id = v.workspace_id
                  AND t.id::text = ANY (a.allowed_tool_ids)
           )                   AS is_granted
      FROM tool_versions v
      JOIN tools t ON t.id = v.tool_id
     WHERE v.review_state = 'pending';

COMMENT ON VIEW tool_versions_pending_review IS
    'Tool changes waiting for review, with whether any agent is currently '
    'granted the tool. A pending change to an ungranted tool is a chore; to a '
    'granted one it is a security review.';
