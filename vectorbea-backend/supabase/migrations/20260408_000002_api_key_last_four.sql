-- Store the last 4 characters of the raw api key at creation time so the
-- management UI can display "vb_••••••••••••abcd" identifiers in the same
-- style as OpenAI's dashboard without ever persisting the raw key.
alter table public.api_keys
    add column if not exists key_last_four text not null default '';
