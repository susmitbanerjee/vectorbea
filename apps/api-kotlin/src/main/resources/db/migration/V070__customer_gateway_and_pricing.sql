-- ═══════════════════════════════════════════════════════════════════════════
-- V070 — A CUSTOMER'S OWN AI GATEWAY, AT A CUSTOMER'S OWN PRICE
--
-- ── WHAT THE CURRENT MODEL ASSUMES, AND WHY THAT BREAKS ───────────────────
-- The connection model already carries `provider` and a `baseUrl` in
-- `config_json`, so pointing a connection at a different host almost works
-- today. Two things stop it being a supported thing rather than an accident:
--
--   1. `provider` doubles as the WIRE PROTOCOL. `LlmNodeExecutor.callProvider`
--      dispatches `anthropic` / `gemini` / else-OpenAI-compatible on it, so a
--      connection named for the customer's gateway lands in the OpenAI branch
--      by falling off the end of a `when` — correct by accident, and silently
--      wrong the day that default changes.
--
--   2. The price table is a hard-coded `when` over model-name substrings, in
--      Kotlin. An enterprise on a negotiated rate is not paying list, and
--      frequently is not paying per-token at all — a committed-spend contract
--      prices the same model differently for two customers. Every cost figure
--      we show them is then wrong, in the direction that loses trust fastest:
--      we over-report their spend and they conclude the platform is expensive.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. THE PROTOCOL, SEPARATED FROM THE PROVIDER
-- ───────────────────────────────────────────────────────────────────────────
--
-- `provider` keeps its meaning — WHOSE capacity, whose credential, whose
-- circuit breaker, whose price. It is the key for the capacity bucket
-- (`capacity:{acct:<fp>}:<provider>:<model>`) and the breaker, and a customer's
-- gateway genuinely is a separate pool of capacity from api.openai.com.
--
-- `protocol` is new and answers a different question: what does the wire look
-- like. Most customer gateways speak OpenAI's shape whatever is behind them —
-- that is the entire point of an OpenAI-compatible shim — so this defaults to
-- the shape the connection's provider has always implied and is only set when
-- the two differ.
ALTER TABLE connections
    ADD COLUMN IF NOT EXISTS protocol TEXT;

DO $$ BEGIN
    ALTER TABLE connections
        ADD CONSTRAINT connections_protocol_check
        CHECK (protocol IS NULL OR protocol IN ('openai', 'anthropic', 'gemini'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN connections.protocol IS
    'The wire shape, when it differs from what `provider` implies: a customer '
    'gateway whose provider is `acme-gateway` but which speaks OpenAI''s '
    'request format. NULL keeps the pre-V070 behaviour exactly — the protocol is '
    'inferred from the provider name, which is what every existing row wants.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. THE PRICE THIS CUSTOMER ACTUALLY PAYS
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── WHY PER CONNECTION AND NOT PER WORKSPACE ──────────────────────────────
-- A connection is the credential, and the credential is what the contract is
-- attached to. One workspace routinely holds several: a negotiated enterprise
-- agreement for production and a personal key for a scratch environment, at
-- different rates for the same model name. Keying on the workspace would price
-- both at whichever was configured last.
CREATE TABLE IF NOT EXISTS connection_model_prices (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL,
    connection_id   UUID        NOT NULL REFERENCES connections (id) ON DELETE CASCADE,

    -- The model this rate applies to. Either an exact name, or a prefix ending
    -- in `*` — a contract is usually quoted per model FAMILY, and enumerating
    -- every point release of it is a maintenance burden that will be forgotten
    -- the first time the provider ships one.
    model_pattern   TEXT        NOT NULL,

    -- Quoted the way contracts are quoted: separately, per million tokens.
    --
    -- The platform's own list price is a single blended rate applied to an
    -- effective billable token count, and that stays exactly as it was — this
    -- is a second path, taken only when an override exists, so nobody's
    -- existing numbers move.
    input_usd_per_million   NUMERIC(14,6) NOT NULL,
    output_usd_per_million  NUMERIC(14,6) NOT NULL,

    -- NULL means "derive it", at the provider's own published cache multiplier.
    -- Most contracts say nothing about cached input, and inventing a rate is
    -- worse than applying the one the provider publishes.
    cached_input_usd_per_million NUMERIC(14,6),

    -- ── STORED, AND CURRENTLY CONSTRAINED TO USD ──────────────────────────
    -- Every downstream number — budgets, ceilings, the usage ledger, the
    -- dashboard — is USD. Accepting a EUR rate without an FX rate and a
    -- conversion date would silently misprice a customer's entire history by
    -- whatever the pair moved. So the column exists, because the question is
    -- asked in the first procurement call, and the check refuses the answer we
    -- cannot honour rather than pretending.
    currency        TEXT        NOT NULL DEFAULT 'USD',

    note            TEXT,
    created_by_user_id UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT connection_model_prices_currency_check CHECK (currency = 'USD'),
    CONSTRAINT connection_model_prices_nonnegative CHECK (
        input_usd_per_million >= 0
        AND output_usd_per_million >= 0
        AND (cached_input_usd_per_million IS NULL OR cached_input_usd_per_million >= 0)
    ),
    -- One rate per model per connection. A second row for the same pattern is a
    -- misconfiguration whose symptom would be "the cost changes depending on
    -- which row the query happened to read first".
    CONSTRAINT connection_model_prices_unique UNIQUE (connection_id, model_pattern)
);

CREATE INDEX IF NOT EXISTS connection_model_prices_lookup_idx
    ON connection_model_prices (connection_id);

COMMENT ON TABLE connection_model_prices IS
    'A customer''s negotiated rate for a model on one connection. Read on the '
    'cost path of every model call made through that connection; absent, the '
    'platform''s list price applies and nothing about the calculation changes.';

COMMENT ON COLUMN connection_model_prices.model_pattern IS
    'An exact model name, or a prefix ending in `*`. The LONGEST matching '
    'pattern wins, so `gpt-4o-mini` beats `gpt-4o*` beats `*` — otherwise a '
    'catch-all row added for convenience would silently override every specific '
    'rate configured before it.';
