-- Add a workspace_role column to api_keys so machine credentials carry an
-- explicit privilege level.  API keys are not users and cannot be looked up
-- in workspace_members, so the role must be stored on the key itself.
--
-- Default is 'editor' — enough to write prompts and post audit logs, but not
-- enough to issue new keys (admin-only).  Administrators must explicitly
-- escalate a key to 'admin' when they need key-management capabilities.

alter table public.api_keys
    add column if not exists key_role text not null default 'editor'
        check (key_role in ('admin', 'editor', 'viewer'));

comment on column public.api_keys.key_role is
    'Privilege level of this machine credential within its workspace. '
    'Mirrors workspace_role but stored on the key because API keys are '
    'not rows in workspace_members.';
