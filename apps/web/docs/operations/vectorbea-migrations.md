# VectorBea migration note

Apply these migrations in order when enabling the governance and ingest token changes:

1. `20260506_governance_incidents_controls.sql`
2. `20260508_ingest_tokens.sql`

## What each migration adds

### `20260506_governance_incidents_controls.sql`

Adds the governance and incident control schema, including:

- `vectorbea.ai_incidents`
- `vectorbea.failure_clusters`
- `vectorbea.failure_cluster_items`
- `vectorbea.incident_activity`
- `vectorbea.incident_verifications`
- `vectorbea.audit_events`
- `vectorbea.approval_requests`
- `vectorbea.approval_decisions`
- `vectorbea.policy_packs`
- `vectorbea.capability_policy_pack_assignments`
- `vectorbea.redaction_rules`
- `vectorbea.privacy_settings`

### `20260508_ingest_tokens.sql`

Adds workspace scoped ingest tokens for SDK, sidecar, proxy, and secure backend trace ingestion:

- `vectorbea.ingest_tokens`

## Apply in staging first

Recommended order:

1. Apply both migrations to staging
2. Verify SDK token creation works
3. Verify ingestion with a valid token succeeds
4. Verify revoked and expired tokens are rejected
5. Verify Policy Packs load correctly
6. Verify Free and Plus can preview packs but cannot apply them
7. Verify Pro and Enterprise can apply packs
8. Promote the same migrations to production

## Verification queries

```sql
select to_regclass('vectorbea.ingest_tokens');
select to_regclass('vectorbea.policy_packs');
select to_regclass('vectorbea.ai_incidents');
select to_regclass('vectorbea.audit_events');
```

## Operational checks

- Create an ingest token from the SDK settings page
- Confirm the raw token is shown once and not returned again in list views
- Send a test trace through `/api/ingest/traces`
- Confirm invalid supplied tokens return `401`
- Confirm a mismatched `workspace_id` in payload is rejected
- Confirm Policy Packs page loads for all plans
- Confirm Apply remains locked for Free and Plus

## Token format note

Current ingest tokens use the `vb_li_` prefix for backward compatibility.

- Existing `vb_li_` tokens remain supported
- Operators should not force a prefix migration during this rollout
- Future additive prefixes can be introduced later without invalidating current tokens

## Rollback note

No destructive rollback script is documented here.

Use database backups, manual migration review, and a normal release rollback process rather than ad hoc destructive SQL in production.
