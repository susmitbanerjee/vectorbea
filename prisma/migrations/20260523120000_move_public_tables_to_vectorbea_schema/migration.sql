CREATE SCHEMA IF NOT EXISTS vectorbea;

DO $$
DECLARE
  t text;
  app_tables text[] := ARRAY[
    'organizations',
    'users',
    'agent_jobs',
    'agent_runs',
    'agent_run_steps',
    'approval_requests',
    'budget_policies',
    'audit_logs',
    'connections'
  ];
BEGIN
  FOREACH t IN ARRAY app_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND to_regclass(format('vectorbea.%I', t)) IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA vectorbea', t);
    END IF;
  END LOOP;
END
$$;
