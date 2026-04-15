-- Add columns required by the UI that were missing from the original schema.

-- prompts: add updated_at so the list can be sorted by last modification
alter table vectorbea.prompts
    add column if not exists updated_at timestamptz not null default now();

-- Back-fill existing rows
update vectorbea.prompts set updated_at = created_at where updated_at = now();

-- Keep updated_at current on every row change
create or replace function vectorbea.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists prompts_set_updated_at on vectorbea.prompts;
create trigger prompts_set_updated_at
    before update on vectorbea.prompts
    for each row execute function vectorbea.set_updated_at();

-- audit_logs: add denormalised prompt_name and version_tag columns so the
-- audit log list can display them without an expensive join on every read.
alter table vectorbea.audit_logs
    add column if not exists prompt_name  text not null default '',
    add column if not exists version_tag  text not null default '';

-- Back-fill from the joined tables for any existing rows
update vectorbea.audit_logs al
set
    prompt_name = coalesce(p.name, ''),
    version_tag = coalesce(pv.version_tag, '')
from vectorbea.prompt_versions pv
join vectorbea.prompts p on p.id = pv.prompt_id
where pv.id = al.prompt_version_id
  and (al.prompt_name = '' or al.version_tag = '');

create index if not exists idx_audit_logs_prompt_name
    on vectorbea.audit_logs (prompt_name);
