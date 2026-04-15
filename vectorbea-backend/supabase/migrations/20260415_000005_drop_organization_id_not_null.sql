-- organization_id is redundant now that workspace_id exists (workspaces
-- already belong to organizations). Drop the not-null constraint so inserts
-- using only workspace_id don't fail.

alter table vectorbea.prompts
    alter column organization_id drop not null;

alter table vectorbea.audit_logs
    alter column organization_id drop not null;

drop index if exists vectorbea.idx_prompts_organization_id;
drop index if exists vectorbea.idx_audit_logs_organization_id;
