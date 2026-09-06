-- =============================================================================
-- V063__billing.sql
--
-- S4: the complete billing integration, switched off.
--
-- ── THE GOAL IS THAT TURNING IT ON IS CONFIGURATION ─────────────────────────
-- There is no bank account yet. Everything below is built, tested and inert:
-- `BILLING_PROVIDER` defaults to `noop`, and the noop provider is a complete
-- implementation of the contract that simply never talks to anybody. Switching
-- to Stripe or Razorpay later sets an env var and a per-account column.
--
-- ── OUR SCHEMA IS THE TRUTH; THE PROVIDER IS A REFERENCE ────────────────────
-- Every object here has OUR id as its primary key and the provider's id in an
-- `external_*` column. Nothing reads from a provider to answer a question.
--
-- That is not tidiness, it is the §3 requirement: a quota check must never call
-- Stripe. If entitlements depended on a provider read, a provider outage would
-- stop every run on the platform — we would have taken an availability
-- dependency on a company we do not operate, for a number we already know.
-- Webhooks push state INTO this schema; enforcement reads only from here.
--
-- ── TWO PROVIDERS FROM DAY ONE, SO THE ABSTRACTION IS LOAD-BEARING ──────────
-- Razorpay for India, Stripe internationally. An interface with one
-- implementation is a guess about what varies; with two it is a fact. The
-- differences that actually shaped this schema:
--
--   · Stripe prices are objects with ids; Razorpay plans are too, but the id
--     shapes and the create semantics differ — hence `provider_price_refs`
--     rather than a column on the plan.
--   · Stripe signs webhooks with a timestamped HMAC over the raw body;
--     Razorpay signs the raw body alone. Both need the RAW bytes, which is why
--     the webhook route must not re-serialise before verifying.
--   · Razorpay is INR + GST; Stripe is many currencies with Stripe Tax. Hence
--     currency on the ACCOUNT, decided once, and tax fields on the invoice.
--
-- ── NO PCI SCOPE, STRUCTURALLY ──────────────────────────────────────────────
-- `payment_methods` holds a brand, an expiry and four digits. There is no
-- column a card number could be written to, and a CHECK enforces that `last4`
-- cannot hold more than four characters. Card details go to the provider's
-- hosted elements and never traverse our servers.
-- =============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Prices, per plan and per currency
--
-- `plans.price_cents` (V060) was one number in one currency, which was right
-- while price was informational. Charging money needs a price per CURRENCY —
-- ₹1,999 is not "$24 converted", it is a decision — and a different external id
-- per provider for the same price.
--
-- Minor units throughout: cents, paise. Never a float. A float that survives one
-- round trip through a currency conversion is a rounding difference somebody has
-- to explain to a customer.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS plan_prices (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    plan_code        TEXT        NOT NULL REFERENCES plans(code) ON DELETE CASCADE,

    /* ISO 4217. Uppercase, three letters — checked, because a lowercase 'usd'
       reaching a provider is a 400 at the worst possible moment. */
    currency         TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    billing_interval TEXT        NOT NULL DEFAULT 'month'
        CHECK (billing_interval IN ('month','year')),

    /* Minor units. 4900 = $49.00 = ₹49.00, depending on `currency`. */
    unit_amount_minor BIGINT     NOT NULL CHECK (unit_amount_minor >= 0),

    /* Whether `unit_amount_minor` includes tax. India quotes GST-inclusive;
       the US quotes exclusive. Getting this wrong is an 18% error in the
       customer's favour or ours, and neither is recoverable quietly. */
    tax_behavior     TEXT        NOT NULL DEFAULT 'exclusive'
        CHECK (tax_behavior IN ('inclusive','exclusive')),

    active           BOOLEAN     NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    /* One live price per plan+currency+interval. A second would make "what does
       Pro cost in INR" ambiguous, and the ambiguity would be resolved
       differently by the pricing page and the checkout. */
    CONSTRAINT plan_prices_unique UNIQUE (plan_code, currency, billing_interval)
);

CREATE INDEX IF NOT EXISTS plan_prices_lookup_idx
    ON plan_prices (currency, billing_interval) WHERE active;

COMMENT ON TABLE plan_prices IS
    'The price of a plan in one currency. The UI renders from here and never '
    'hardcodes a number — re-pricing is an UPDATE, and a price on a screen that '
    'disagrees with the invoice is the worst bug this area has.';

/**
 * The provider's id for one of our prices.
 *
 * Separate from `plan_prices` because the same price exists at both providers
 * with different ids, and because a provider being added later must not require
 * a column. Nothing READS a price from here — this is only what we send when
 * creating a subscription.
 */
CREATE TABLE IF NOT EXISTS provider_price_refs (
    plan_price_id     UUID  NOT NULL REFERENCES plan_prices(id) ON DELETE CASCADE,
    provider          TEXT  NOT NULL CHECK (provider IN ('stripe','razorpay','noop')),
    external_price_id TEXT  NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_price_id, provider)
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The account's billing identity
--
-- ── CURRENCY IS DECIDED AT SIGNUP, NOT PER TRANSACTION ──────────────────────
-- Per-transaction currency means an account with a mixed-currency invoice
-- history, a revenue figure that needs an FX rate to compute, and a customer who
-- was quoted one number and charged another. Once chosen it is fixed; changing
-- it is a support action that ends one subscription and starts another, because
-- that is genuinely what it is.
--
-- Country drives BOTH the provider and the tax treatment, so it is stored rather
-- than inferred from an IP at checkout time.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE billing_accounts
    ADD COLUMN IF NOT EXISTS provider      TEXT NOT NULL DEFAULT 'noop'
        CHECK (provider IN ('noop','stripe','razorpay')),
    ADD COLUMN IF NOT EXISTS currency      TEXT CHECK (currency ~ '^[A-Z]{3}$'),
    ADD COLUMN IF NOT EXISTS country       TEXT CHECK (country ~ '^[A-Z]{2}$'),
    ADD COLUMN IF NOT EXISTS billing_email TEXT,
    /* GSTIN for India, VAT/EIN elsewhere. Stored as given; validated by the
       provider, not by us — a regex per jurisdiction is a maintenance burden
       that would reject a valid id somewhere. */
    ADD COLUMN IF NOT EXISTS tax_id        TEXT,
    ADD COLUMN IF NOT EXISTS tax_id_type   TEXT,
    /* Set when a past-due account has exhausted its warning schedule. Refuses
       NEW runs and nothing else — see §5. */
    ADD COLUMN IF NOT EXISTS billing_restricted_at TIMESTAMPTZ;

COMMENT ON COLUMN billing_accounts.provider IS
    'Which BillingProvider serves this account. ''noop'' is the default and what '
    'runs until a bank account exists. Per-account rather than global so India '
    'can be on Razorpay while everybody else is on Stripe.';

COMMENT ON COLUMN billing_accounts.billing_restricted_at IS
    'A past-due account that has run out of warnings. Refuses new runs; NEVER '
    'touches retention. Deleting a customer''s data over a late card is not a '
    'dunning step, it is a catastrophe.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Subscriptions
--
-- One row per subscription we have ever had, not one per account: a cancelled
-- subscription followed by a new one is two rows, and "what were they on in
-- March" has to stay answerable.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS subscriptions (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,

    plan_code          TEXT        NOT NULL REFERENCES plans(code),
    plan_price_id      UUID        REFERENCES plan_prices(id),
    quantity           INTEGER     NOT NULL DEFAULT 1 CHECK (quantity >= 1),

    provider           TEXT        NOT NULL DEFAULT 'noop'
        CHECK (provider IN ('noop','stripe','razorpay')),
    external_subscription_id TEXT,

    status             TEXT        NOT NULL DEFAULT 'trialing'
        CHECK (status IN ('trialing','active','past_due','canceled','incomplete')),

    trial_end          TIMESTAMPTZ,
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,

    /* Cancellation runs to period end (§5). `canceled_at` is when they ASKED;
       the subscription keeps working until `current_period_end`. Two columns
       because "they cancelled" and "it stopped" are different dates and support
       is always asked about the gap between them. */
    cancel_at_period_end BOOLEAN   NOT NULL DEFAULT false,
    canceled_at        TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,

    /* When the first payment failed. The dunning schedule counts from here. */
    past_due_since     TIMESTAMPTZ,

    /* The PROVIDER's timestamp on the last event applied to this row.
    
       The ordering authority, and it must be the provider's clock rather than
       ours. Comparing an incoming `occurred_at` against our own `updated_at`
       compares two different clocks measuring two different things — and gets it
       wrong immediately, because a row we wrote a millisecond ago has an
       `updated_at` later than the `occurred_at` of the event that is about to
       arrive describing it. Every first webhook would be rejected as stale. */
    last_event_at      TIMESTAMPTZ,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_account_idx
    ON subscriptions (billing_account_id, created_at DESC);

/* At most ONE live subscription per account. Two would make "what plan are they
   on" ambiguous, and the ambiguity would be resolved differently by the
   entitlement resolver and the invoice. */
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_account
    ON subscriptions (billing_account_id)
    WHERE status IN ('trialing','active','past_due','incomplete');

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_external_idx
    ON subscriptions (provider, external_subscription_id)
    WHERE external_subscription_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Invoices and lines
--
-- Stored rather than proxied from the provider, so invoice history survives a
-- provider outage, a provider migration and an account that has moved from
-- Razorpay to Stripe. `hosted_url` and `pdf_url` are the provider's copies —
-- convenience links, never the source of the numbers.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS invoices (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
    subscription_id    UUID        REFERENCES subscriptions(id) ON DELETE SET NULL,

    /* Ours, human-facing, monotonic per account. The provider has its own. */
    number             TEXT,

    currency           TEXT        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    subtotal_minor     BIGINT      NOT NULL DEFAULT 0,
    tax_minor          BIGINT      NOT NULL DEFAULT 0,
    total_minor        BIGINT      NOT NULL DEFAULT 0,
    amount_paid_minor  BIGINT      NOT NULL DEFAULT 0,

    /* GST for India: the rate and the components, because an Indian invoice must
       show CGST/SGST or IGST separately and a single "tax" line is not a legal
       invoice there. Null everywhere else. */
    tax_rate_bp        INTEGER,
    tax_breakdown      JSONB,

    status             TEXT        NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','open','paid','uncollectible','void')),

    period_start       TIMESTAMPTZ,
    period_end         TIMESTAMPTZ,
    issued_at          TIMESTAMPTZ,
    due_at             TIMESTAMPTZ,
    paid_at            TIMESTAMPTZ,

    provider           TEXT,
    external_invoice_id TEXT,
    hosted_url         TEXT,
    pdf_url            TEXT,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_account_idx
    ON invoices (billing_account_id, issued_at DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_external_idx
    ON invoices (provider, external_invoice_id)
    WHERE external_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS invoice_lines (
    id            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice_id    UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

    description   TEXT        NOT NULL,
    /* Null for a flat subscription line; set for a metered one, and it names the
       `usage_records.metric` it came from so a customer disputing a line can be
       shown the runs behind it. */
    metric        TEXT,
    quantity      NUMERIC(20,4) NOT NULL DEFAULT 1,
    unit_amount_minor BIGINT  NOT NULL DEFAULT 0,
    amount_minor  BIGINT      NOT NULL DEFAULT 0,

    period_start  TIMESTAMPTZ,
    period_end    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines (invoice_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Payment methods — NO PCI SCOPE
--
-- There is deliberately no column a card number could be written to. `last4` is
-- CHECK-constrained to four characters, so even a mistaken write of a full PAN
-- fails loudly at the database rather than succeeding quietly.
--
-- Card details reach the provider through their hosted elements, in the
-- customer's browser, and never touch our servers. What comes back is a token
-- and a few display fields, which is all that is here.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payment_methods (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,

    provider           TEXT        NOT NULL CHECK (provider IN ('stripe','razorpay','noop')),
    external_payment_method_id TEXT NOT NULL,

    /* card | upi | netbanking | emandate | wallet. Razorpay's world is wider
       than a card, and modelling only cards would have made India a special
       case at every call site. */
    kind               TEXT        NOT NULL DEFAULT 'card',

    brand              TEXT,
    last4              TEXT        CHECK (last4 IS NULL OR length(last4) <= 4),
    exp_month          SMALLINT    CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
    exp_year           SMALLINT,
    /* For UPI/emandate, the masked handle the provider returns. Never a secret. */
    display_label      TEXT,

    is_default         BOOLEAN     NOT NULL DEFAULT false,
    removed_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT payment_methods_external_unique UNIQUE (provider, external_payment_method_id)
);

/* One default per account, enforced rather than assumed. Two defaults means the
   charge goes to whichever the query happened to order first. */
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_one_default
    ON payment_methods (billing_account_id)
    WHERE is_default AND removed_at IS NULL;

COMMENT ON TABLE payment_methods IS
    'Display metadata for a provider-held payment instrument. Holds no card '
    'number and has nowhere to put one: `last4` is CHECK-limited to 4 chars, so '
    'a mistaken PAN write fails at the database instead of succeeding quietly.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Webhook events — idempotent, ordered, and never inferred
--
-- ── THREE PROPERTIES, EACH FROM A DIFFERENT FAILURE ─────────────────────────
--
-- IDEMPOTENT. `UNIQUE (provider, external_event_id)`. Providers retry; a
-- duplicate `invoice.paid` must not credit twice. The unique constraint is the
-- mechanism, not a check-then-insert, because two retries can arrive
-- concurrently and both pass a check.
--
-- ORDERED. Providers reorder. `occurred_at` is the PROVIDER's timestamp, and a
-- handler that would apply an older state than the row already has must decline.
-- Arrival order says nothing: `customer.subscription.updated` for a cancellation
-- can land before the `.created` for the subscription it cancels.
--
-- NEVER INFERRED. An unrecognised type is stored with status `ignored` and
-- logged. It is not guessed at from its name, not partially applied, and not
-- dropped — the same discipline as `decideOnApproval`: anything unrecognised
-- means wait. The row stays so the event can be replayed once a handler exists.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS billing_events (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,

    provider           TEXT        NOT NULL CHECK (provider IN ('stripe','razorpay','noop')),
    /* The provider's own event id. THE idempotency key. */
    external_event_id  TEXT        NOT NULL,
    type               TEXT        NOT NULL,

    /* When the PROVIDER says it happened, not when it reached us. The ordering
       authority — see the note above. */
    occurred_at        TIMESTAMPTZ,
    received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at       TIMESTAMPTZ,

    status             TEXT        NOT NULL DEFAULT 'received'
        CHECK (status IN ('received','processed','ignored','stale','failed')),

    signature_verified BOOLEAN     NOT NULL DEFAULT false,
    /* The raw body, kept for replay and for arguing with a provider about what
       they actually sent. Sanitised of nothing, because a webhook body carries
       no secret — the signature is in a header. */
    payload            JSONB,

    billing_account_id UUID,
    subscription_id    UUID,
    error              TEXT,

    CONSTRAINT billing_events_idempotent UNIQUE (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS billing_events_unprocessed_idx
    ON billing_events (received_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS billing_events_account_idx
    ON billing_events (billing_account_id, occurred_at DESC);

COMMENT ON TABLE billing_events IS
    'Every webhook, exactly once. UNIQUE(provider, external_event_id) is the '
    'idempotency mechanism; `occurred_at` is the ordering authority. An '
    'unrecognised type is stored as ''ignored'', never inferred.';


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Usage reporting — idempotent in the other direction
--
-- §6: "a replayed webhook or a retried report must not double-charge". The
-- webhook side is §6 above; this is the outbound side.
--
-- ── THE KEY IS DERIVED, NOT GENERATED ───────────────────────────────────────
-- `idempotency_key` is `account:period:metric:quantity-bucket`, computed from
-- the facts. A generated UUID would be different on every retry and would defeat
-- the entire mechanism — which is the same rule the run ledger follows, and for
-- the same reason.
--
-- ── AND REPORTING IS ABSOLUTE, NOT INCREMENTAL ──────────────────────────────
-- Each report states the period's TOTAL, so a lost report is corrected by the
-- next one and a duplicated report changes nothing. Sending deltas would make
-- every retry a double charge and every lost report a permanent undercount.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS usage_reports (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
    subscription_id    UUID        REFERENCES subscriptions(id) ON DELETE SET NULL,

    period_start       TIMESTAMPTZ NOT NULL,
    metric             TEXT        NOT NULL,
    /* The period's TOTAL as of this report, never a delta. */
    quantity           NUMERIC(20,4) NOT NULL,

    provider           TEXT        NOT NULL,
    idempotency_key    TEXT        NOT NULL,
    external_usage_id  TEXT,

    status             TEXT        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','reported','failed','skipped')),
    error              TEXT,

    reported_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT usage_reports_idempotent UNIQUE (provider, idempotency_key)
);

CREATE INDEX IF NOT EXISTS usage_reports_period_idx
    ON usage_reports (billing_account_id, period_start, metric);


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Reconciliation — because a silent drift is a silent revenue loss
--
-- §6: "Reconcile reported usage against local meters on a schedule and alert on
-- drift." A report that quietly stopped succeeding looks exactly like a quiet
-- month, and the difference is only visible against the local meter.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS billing_reconciliations (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    billing_account_id UUID        NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
    period_start       TIMESTAMPTZ NOT NULL,
    metric             TEXT        NOT NULL,

    /* What our meter says, from usage_records — the S1 ledger. */
    local_quantity     NUMERIC(20,4) NOT NULL,
    /* What we last successfully told the provider. */
    reported_quantity  NUMERIC(20,4) NOT NULL,
    drift              NUMERIC(20,4) NOT NULL,

    status             TEXT        NOT NULL DEFAULT 'ok'
        CHECK (status IN ('ok','drift','unreported')),

    checked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT billing_reconciliations_unique
        UNIQUE (billing_account_id, period_start, metric, checked_at)
);

CREATE INDEX IF NOT EXISTS billing_reconciliations_drift_idx
    ON billing_reconciliations (checked_at DESC) WHERE status <> 'ok';


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Lifecycle → entitlements
--
-- ── THE INTEGRATION POINT WITH S3, AND THE ONE RULE IT MUST NOT BREAK ───────
-- Entitlements resolve from `billing_accounts.plan_code`. Billing changes that
-- column and nothing else — which means a quota check never learns that billing
-- exists, and a provider outage cannot reach it.
--
-- ── PAST DUE DEGRADES; IT DOES NOT CUT OFF, AND IT NEVER TOUCHES DATA ───────
-- The dunning schedule sets `billing_restricted_at`, which refuses NEW runs. It
-- deliberately does NOT change `plan_code`, because `plan_code` drives
-- RETENTION — and shortening a customer's retention over a late card would have
-- the S2 sweeper delete their traces. A failed payment must never destroy data.
--
-- Cancellation is different and does move the plan, but only at period end, and
-- through the account's plan_code — which means S2's downgrade grace opens
-- automatically on the next sweep, exactly as it does for any other plan change.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * The dunning schedule, in days from the first failed payment.
 *
 * Data rather than constants so a jurisdiction or a customer segment can differ
 * without a deploy — and so the UI can say "your access is restricted on the
 * 21st" using the same numbers the job uses.
 */
CREATE TABLE IF NOT EXISTS dunning_policy (
    only_row        BOOLEAN     PRIMARY KEY DEFAULT true CHECK (only_row),
    /* Warn in-product from here. Full access continues. */
    warn_after_days     INTEGER NOT NULL DEFAULT 1,
    /* Escalate the warning. Still full access. */
    escalate_after_days INTEGER NOT NULL DEFAULT 7,
    /* Refuse NEW runs. Data, reads and retention untouched. */
    restrict_after_days INTEGER NOT NULL DEFAULT 21,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO dunning_policy (only_row) VALUES (true) ON CONFLICT DO NOTHING;

/**
 * Where an account stands in the dunning schedule.
 *
 * Returns a stage and the DATE of the next step, because a warning without a
 * date is a warning nobody can act on — and the date has to come from the same
 * arithmetic the enforcement uses or the two will disagree.
 */
CREATE OR REPLACE FUNCTION billing_dunning_state(p_account_id UUID)
RETURNS TABLE (stage TEXT, days_past_due INTEGER, next_step_at TIMESTAMPTZ, restricted BOOLEAN)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    since  TIMESTAMPTZ;
    pol    RECORD;
    d      INTEGER;
BEGIN
    SELECT s.past_due_since INTO since
      FROM subscriptions s
     WHERE s.billing_account_id = p_account_id
       AND s.status = 'past_due'
     ORDER BY s.created_at DESC LIMIT 1;

    IF since IS NULL THEN
        stage := 'current'; days_past_due := 0; next_step_at := NULL; restricted := false;
        RETURN NEXT; RETURN;
    END IF;

    SELECT * INTO pol FROM dunning_policy LIMIT 1;
    d := GREATEST(0, EXTRACT(DAY FROM (now() - since))::INTEGER);

    IF d >= pol.restrict_after_days THEN
        stage := 'restricted'; next_step_at := NULL; restricted := true;
    ELSIF d >= pol.escalate_after_days THEN
        stage := 'escalated';
        next_step_at := since + make_interval(days => pol.restrict_after_days);
        restricted := false;
    ELSIF d >= pol.warn_after_days THEN
        stage := 'warning';
        next_step_at := since + make_interval(days => pol.escalate_after_days);
        restricted := false;
    ELSE
        stage := 'grace';
        next_step_at := since + make_interval(days => pol.warn_after_days);
        restricted := false;
    END IF;

    days_past_due := d;
    RETURN NEXT;
END;
$$;

/**
 * Apply the schedule. Called by the dunning job; safe to run repeatedly.
 *
 * Sets or clears `billing_restricted_at` and nothing else. Returns how many
 * accounts changed, so a job that suddenly restricts a thousand accounts is
 * visible as a number rather than as a thousand support tickets.
 */
CREATE OR REPLACE FUNCTION billing_apply_dunning()
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    n INTEGER := 0;
BEGIN
    WITH state AS (
        SELECT b.id, d.restricted
          FROM billing_accounts b
          CROSS JOIN LATERAL billing_dunning_state(b.id) d
    ),
    changed AS (
        UPDATE billing_accounts b
           SET billing_restricted_at =
                   CASE WHEN s.restricted THEN COALESCE(b.billing_restricted_at, now())
                        ELSE NULL END,
               updated_at = now()
          FROM state s
         WHERE s.id = b.id
           AND (s.restricted) IS DISTINCT FROM (b.billing_restricted_at IS NOT NULL)
        RETURNING 1
    )
    SELECT count(*) INTO n FROM changed;
    RETURN n;
END;
$$;

/**
 * Move a cancelled subscription's account to `free`, at period end and not
 * before.
 *
 * §5: "Cancellation runs to period end." Called by the same job. Changing
 * `plan_code` here is what makes S2's retention grace open on the next sweep —
 * the customer's data is protected by the downgrade path that already exists,
 * rather than by anything billing has to remember to do.
 */
CREATE OR REPLACE FUNCTION billing_settle_ended_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    n INTEGER := 0;
    r RECORD;
BEGIN
    FOR r IN
        SELECT s.id, s.billing_account_id
          FROM subscriptions s
         WHERE s.status IN ('active','past_due','trialing')
           AND s.cancel_at_period_end
           AND s.current_period_end IS NOT NULL
           AND s.current_period_end <= now()
    LOOP
        UPDATE subscriptions
           SET status = 'canceled', ended_at = now(), updated_at = now()
         WHERE id = r.id;

        UPDATE billing_accounts
           SET plan_code = 'free', plan_status = 'canceled',
               billing_restricted_at = NULL, updated_at = now()
         WHERE id = r.billing_account_id;

        n := n + 1;
    END LOOP;
    RETURN n;
END;
$$;

/**
 * What our meters say for an account's current period, as the reporter sends it.
 *
 * Reads `usage_records` — the S1 ledger — so what is billed is exactly what was
 * metered: one row per run, replays excluded, resumes counted once. A second
 * aggregation path here would be a second opinion about revenue.
 */
CREATE OR REPLACE FUNCTION billing_reportable_usage(p_account_id UUID)
RETURNS TABLE (metric TEXT, quantity NUMERIC, period_start TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
    SELECT u.metric, COALESCE(SUM(u.quantity), 0), p.period_start
      FROM account_current_period(p_account_id) p
      LEFT JOIN usage_records u
        ON u.billing_account_id = p_account_id
       AND u.period_start >= p.period_start
       AND u.period_start <  p.period_end
     GROUP BY u.metric, p.period_start
    HAVING u.metric IS NOT NULL
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Seed prices, in both currencies
--
-- The UI renders from these and never hardcodes a number, so an empty catalogue
-- means an empty pricing page rather than a wrong one. Seeded for USD and INR
-- because those are the two the providers settle in.
--
-- INR is PRICED, not converted. ₹3,999 is a decision about the Indian market;
-- $49 at an exchange rate would be ₹4,100-ish and would move every time the
-- rupee did, which is not a price anybody can put on a page.
--
-- GST-INCLUSIVE for INR, exclusive for USD — matching how each market quotes.
-- `tax_behavior` exists precisely so this is not one platform-wide assumption.
--
-- ON CONFLICT DO NOTHING: these are a starting point, and re-applying must never
-- undo a re-pricing somebody has done in the database.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO plan_prices (plan_code, currency, billing_interval, unit_amount_minor, tax_behavior) VALUES
    ('free',       'USD', 'month',      0, 'exclusive'),
    ('pro',        'USD', 'month',   4900, 'exclusive'),
    ('team',       'USD', 'month',   9900, 'exclusive'),
    ('enterprise', 'USD', 'month',  49900, 'exclusive'),

    ('free',       'INR', 'month',      0, 'inclusive'),
    ('pro',        'INR', 'month', 399900, 'inclusive'),
    ('team',       'INR', 'month', 799900, 'inclusive'),
    ('enterprise', 'INR', 'month', 3999900, 'inclusive'),

    /* Annual, at ten months for twelve — the usual shape, stated as a price
       rather than computed with a discount percentage that would have to agree
       with a number on a marketing page. */
    ('pro',        'USD', 'year',   49000, 'exclusive'),
    ('team',       'USD', 'year',   99000, 'exclusive'),
    ('pro',        'INR', 'year',  3999000, 'inclusive'),
    ('team',       'INR', 'year',  7999000, 'inclusive')
ON CONFLICT (plan_code, currency, billing_interval) DO NOTHING;

COMMENT ON TABLE provider_price_refs IS
    'The provider''s id for one of our prices, filled in when a provider is '
    'configured. Empty until then, which is why NoopBillingProvider synthesises '
    'a placeholder rather than failing — the domain must be exercisable before '
    'anybody has created a price at Stripe.';
