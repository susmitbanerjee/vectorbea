-- Drop any stale organization_id-related indexes and columns that should not
-- exist in the vectorbea schema. All tables use workspace_id for isolation.
-- Safe to run even if these objects no longer exist.

drop index if exists vectorbea.idx_prompts_organization_id;
drop index if exists vectorbea.idx_audit_logs_organization_id;

alter table vectorbea.prompts    drop column if exists organization_id;
alter table vectorbea.audit_logs drop column if exists organization_id;
