-- prompts and audit_logs were originally keyed by organization_id.
-- Migration 20260412_000001 added workspace_id for project isolation but
-- only on the public schema copies. Ensure workspace_id exists on the
-- vectorbea schema tables after the schema move.

alter table vectorbea.prompts
    add column if not exists workspace_id uuid references vectorbea.workspaces(id) on delete cascade;

alter table vectorbea.audit_logs
    add column if not exists workspace_id uuid references vectorbea.workspaces(id) on delete cascade;


create index if not exists idx_prompts_workspace_id
    on vectorbea.prompts (workspace_id);

create index if not exists idx_audit_logs_workspace_id
    on vectorbea.audit_logs (workspace_id);
