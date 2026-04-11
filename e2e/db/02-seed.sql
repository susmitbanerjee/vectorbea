insert into public.organizations (id, name)
values ('11111111-1111-4111-8111-111111111111', 'VectorBea E2E Org')
on conflict (id) do nothing;
