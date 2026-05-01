alter table vectorbea.regression_schedules
  add column if not exists provider_type text,
  add column if not exists provider_model text;
