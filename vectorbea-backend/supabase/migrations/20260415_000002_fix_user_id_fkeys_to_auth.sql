-- org_members.user_id and workspace_members.user_id were originally created
-- pointing at public.users (now vectorbea.users). OAuth users only exist in
-- auth.users, so inserts fail with a FK violation. Re-point both FKs to
-- auth.users so any Supabase Auth user can be a member without needing a
-- row in the legacy vectorbea.users table.

-- org_members
alter table vectorbea.org_members
  drop constraint if exists org_members_user_id_fkey;

alter table vectorbea.org_members
  add constraint org_members_user_id_fkey
  foreign key (user_id)
  references auth.users (id)
  on delete cascade;

-- workspace_members
alter table vectorbea.workspace_members
  drop constraint if exists workspace_members_user_id_fkey;

alter table vectorbea.workspace_members
  add constraint workspace_members_user_id_fkey
  foreign key (user_id)
  references auth.users (id)
  on delete cascade;
