-- ─────────────────────────────────────────────────────────────────────────────
-- Billing subscription state columns + webhook idempotency table
--
-- Why this is needed
-- ──────────────────
-- The existing organizations table only tracked plan_tier + stripe_customer_id.
-- To handle the full subscription lifecycle (trial, active, past-due,
-- cancellation, period changes) and to safely replay webhooks without double-
-- applying state changes, we need:
--   1. Three new columns on vectorbea.organizations.
--   2. A vectorbea.webhook_events table as an idempotency store.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Extend vectorbea.organizations ────────────────────────────────────────

alter table vectorbea.organizations
    -- Provider-agnostic subscription identifier.
    -- Lemon Squeezy: sub_<numeric_id>  (stringified from LS numeric ID)
    -- Stripe:        sub_<alpha>       (Stripe's sub_ prefix)
    -- Kept separate from stripe_subscription_id so both providers can coexist
    -- during a future migration without data loss.
    add column if not exists subscription_id      text,

    -- Normalised status reflecting the provider's most recent event.
    -- Valid values match both Stripe and Lemon Squeezy status vocabularies.
    add column if not exists subscription_status  text
        constraint organizations_subscription_status_check
        check (subscription_status in (
            'active', 'trialing', 'past_due', 'unpaid',
            'canceled', 'paused', 'expired'
        )),

    -- End of the current paid period. Used by the UI to show "renews on …"
    -- and to grant a grace period after cancellation before hard downgrade.
    add column if not exists current_period_end   timestamptz;

-- Fast lookup for webhook handlers that resolve an org from subscription_id
-- (e.g. Stripe subscription.updated fires with only a subscription ID).
create unique index if not exists idx_organizations_subscription_id
    on vectorbea.organizations (subscription_id)
    where subscription_id is not null;

-- ── 2. Webhook idempotency table ─────────────────────────────────────────────
--
-- Every successfully processed webhook event is recorded here. The primary
-- key is the provider-scoped event key (e.g. "stripe:evt_1RxXxx" or
-- "ls:abc123-uuid"). Duplicate deliveries hit the PK conflict and are
-- short-circuited before any DB mutation occurs.
--
-- Retention: rows are cheap (< 200 bytes each). A cleanup job can prune
-- rows older than 90 days — no migration needed for that.

create table if not exists vectorbea.webhook_events (
    event_key       text        primary key,   -- "provider:event_id"
    provider        text        not null,      -- 'stripe' | 'lemonsqueezy'
    event_name      text        not null,      -- raw event type from provider
    organization_id uuid        references vectorbea.organizations(id) on delete set null,
    workspace_id    uuid        references vectorbea.workspaces(id)    on delete set null,
    processed_at    timestamptz not null default now()
);

comment on table vectorbea.webhook_events is
    'Idempotency log for incoming billing webhooks. '
    'Insert the event_key before mutating billing state; '
    'a PK conflict means the event was already processed.';

create index if not exists idx_webhook_events_processed_at
    on vectorbea.webhook_events (processed_at desc);

create index if not exists idx_webhook_events_organization_id
    on vectorbea.webhook_events (organization_id);

-- ── 3. Grants ─────────────────────────────────────────────────────────────────

grant all    on table vectorbea.webhook_events to service_role;
grant select on table vectorbea.webhook_events to authenticated;

commit;
