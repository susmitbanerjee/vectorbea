-- organization_id was not carried over when tables moved to vectorbea schema.
-- Drop any leftover indexes that reference it (safe if they don't exist).

drop index if exists vectorbea.idx_prompts_organization_id;
drop index if exists vectorbea.idx_audit_logs_organization_id;
