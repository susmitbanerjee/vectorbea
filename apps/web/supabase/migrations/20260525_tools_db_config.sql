-- Add db_config column to platform_tools for database_read / database_write tool types
ALTER TABLE vectorbea.platform_tools
  ADD COLUMN IF NOT EXISTS db_config jsonb;

COMMENT ON COLUMN vectorbea.platform_tools.db_config IS
  'Config for database_read / database_write tools: { sqlTemplate, parameters, maxRows?, requireApproval? }';
