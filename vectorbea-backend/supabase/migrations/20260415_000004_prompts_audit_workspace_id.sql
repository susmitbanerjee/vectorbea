-- prompts and audit_logs were originally keyed by organization_id.
-- Migration 20260412_000001 added workspace_id for project isolation but
-- only on the public schema copies. Ensure workspace_id exists on the
-- vectorbea schema tables after the schema move.

alter table vectorbea.prompts
    add column if not exists workspace_id uuid references vectorbea.workspaces(id) on delete cascade;

alter table vectorbea.audit_logs
    add column if not exists workspace_id uuid references vectorbea.workspaces(id) on delete cascade;

-- Back-fill workspace_id from organization_id via the first workspace in each org.
-- For existing rows that have organization_id but no workspace_id.
update vectorbea.prompts p
set workspace_id = w.id
from vectorbea.workspaces w
where w.organization_id = p.organization_id
  and p.workspace_id is null;

update vectorbea.audit_logs al
set workspace_id = w.id
from vectorbea.workspaces w
where w.organization_id = al.organization_id
  and al.workspace_id is null;

create index if not exists idx_prompts_workspace_id
    on vectorbea.prompts (workspace_id);

create index if not exists idx_audit_logs_workspace_id
    on vectorbea.audit_logs (workspace_id);
